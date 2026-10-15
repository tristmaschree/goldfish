// Goldfish service worker.
//
// Everything here is event-driven: Chrome shuts this worker down after ~30s
// with nothing to do, so between events Goldfish costs no memory or CPU.
// There are no content scripts; tabs are unloaded with chrome.tabs.discard,
// the same mechanism Chrome's Memory Saver uses.

import { getSettings, hostOf, isProtectedHost } from "./settings.js";

const TICK = "goldfish-tick";

// ---------------------------------------------------------------------------
// Unloading

const isWebPage = (tab) => /^(https?|file):/.test(tab.url || tab.pendingUrl || "");

// Rules for unloading without being asked (timeouts, limits, locking, groups).
function autoEligible(tab, s) {
  return (
    !tab.discarded &&
    !tab.active &&
    !tab.audible &&
    tab.autoDiscardable !== false &&
    !(s.keepPinned && tab.pinned) &&
    isWebPage(tab) &&
    !isProtectedHost(hostOf(tab.url), s.neverUnload)
  );
}

// Rules for bulk actions you trigger yourself ("unload others", a whole group):
// they still spare pinned, playing and never-unload tabs. Tabs you pick
// one by one are always unloaded.
function bulkEligible(tab, s) {
  return (
    !tab.discarded &&
    !tab.audible &&
    !(s.keepPinned && tab.pinned) &&
    !isProtectedHost(hostOf(tab.url), s.neverUnload)
  );
}

// Chrome can't discard the tab you're looking at, so switch away first:
// to the most recently used tab that's still loaded, else the nearest one.
async function stepAway(tab, avoid = new Set([tab.id])) {
  const siblings = await chrome.tabs.query({ windowId: tab.windowId });
  const candidates = siblings.filter((t) => !avoid.has(t.id));
  if (!candidates.length) return false;
  const loaded = candidates.filter((t) => !t.discarded);
  const next = loaded.length
    ? loaded.reduce((a, b) => ((b.lastAccessed || 0) > (a.lastAccessed || 0) ? b : a))
    : candidates.reduce((a, b) => (Math.abs(b.index - tab.index) < Math.abs(a.index - tab.index) ? b : a));
  await chrome.tabs.update(next.id, { active: true });
  return true;
}

// Unload a list of tabs. Returns how many were actually unloaded.
async function unload(tabs) {
  const ids = new Set(tabs.map((t) => t.id));
  let count = 0;
  for (const tab of tabs) {
    if (tab.discarded) continue;
    if (tab.active && !(await stepAway(tab, ids))) continue;
    try {
      await chrome.tabs.discard(tab.id);
      count++;
    } catch {
      // Tab closed meanwhile, or Chrome refused (e.g. a devtools page).
    }
  }
  if (count) {
    const { unloadedTotal = 0 } = await chrome.storage.local.get("unloadedTotal");
    await chrome.storage.local.set({ unloadedTotal: unloadedTotal + count });
  }
  scheduleBadge();
  return count;
}

// ---------------------------------------------------------------------------
// Actions (shared by shortcuts, context menus and the popup)

const actions = {
  // The given tab, or every selected tab if it's part of a multi-selection.
  async selected(tab) {
    const highlighted = await chrome.tabs.query({ windowId: tab.windowId, highlighted: true });
    return unload(highlighted.some((t) => t.id === tab.id) ? highlighted : [tab]);
  },

  async tab(tab) {
    return unload([tab]);
  },

  async others(tab) {
    const s = await getSettings();
    const all = await chrome.tabs.query({ windowId: tab.windowId });
    return unload(all.filter((t) => t.id !== tab.id && bulkEligible(t, s)));
  },

  async right(tab) {
    const s = await getSettings();
    const all = await chrome.tabs.query({ windowId: tab.windowId });
    return unload(all.filter((t) => t.index > tab.index && bulkEligible(t, s)));
  },

  async group(tab) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return 0;
    const s = await getSettings();
    const all = await chrome.tabs.query({ groupId: tab.groupId });
    return unload(all.filter((t) => bulkEligible(t, s)));
  },

  async site(tab) {
    const host = hostOf(tab.url);
    if (!host) return 0;
    const all = await chrome.tabs.query({});
    return unload(all.filter((t) => !t.discarded && hostOf(t.url) === host));
  },

  // Every eligible tab in every window (the popup's "Unload everything idle").
  async everything() {
    const s = await getSettings();
    const all = await chrome.tabs.query({});
    return unload(all.filter((t) => autoEligible(t, s)));
  },
};

// ---------------------------------------------------------------------------
// Automatic rules

// Check often enough to honor the timeout to within ~15%, but never more
// than once a minute (Chrome's floor) or less than every 5 minutes.
async function syncAlarm() {
  const s = await getSettings();
  const needed = s.idleMinutes > 0 || s.maxLoaded > 0;
  if (!needed) return chrome.alarms.clear(TICK);
  const period = s.idleMinutes > 0 ? Math.min(5, Math.max(1, Math.round(s.idleMinutes / 6))) : 1;
  const existing = await chrome.alarms.get(TICK);
  if (existing?.periodInMinutes !== period) {
    await chrome.alarms.create(TICK, { periodInMinutes: period, delayInMinutes: period });
  }
}

async function tick() {
  const s = await getSettings();
  const all = await chrome.tabs.query({});
  const now = Date.now();
  const doomed = new Set();

  if (s.idleMinutes > 0) {
    const cutoff = now - s.idleMinutes * 60_000;
    for (const t of all) {
      if (autoEligible(t, s) && (t.lastAccessed || now) < cutoff) doomed.add(t);
    }
  }

  if (s.maxLoaded > 0) {
    const loaded = all.filter((t) => !t.discarded && !doomed.has(t));
    let excess = loaded.length - s.maxLoaded;
    const oldestFirst = loaded
      .filter((t) => autoEligible(t, s))
      .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
    for (const t of oldestFirst) {
      if (excess-- <= 0) break;
      doomed.add(t);
    }
  }

  if (doomed.size) await unload([...doomed]);
  else scheduleBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) tick();
});

// Collapsing a group means "not now", so unload what's in it.
chrome.tabGroups.onUpdated.addListener(async (group) => {
  if (!group.collapsed) return;
  const s = await getSettings();
  if (!s.unloadCollapsedGroups) return;
  const tabs = await chrome.tabs.query({ groupId: group.id, discarded: false });
  unload(tabs.filter((t) => autoEligible(t, s)));
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== "locked") return;
  const s = await getSettings();
  if (s.unloadOnLock) actions.everything();
});

// ---------------------------------------------------------------------------
// Lazy background tabs: a web page opened in a background tab (Cmd/Ctrl-click,
// middle-click, "Open link in new tab") is unloaded as soon as its URL commits,
// so it shows up in the tab strip but doesn't load until you open it.
// (openerTabId isn't reliably set yet in onCreated, so it isn't used here.)
// Pending ids live in session storage because this worker can be shut down
// between the two events.

// The id is kept in memory too, since the URL can commit before the storage
// write finishes.
const lazyNow = new Set();

chrome.tabs.onCreated.addListener(async (tab) => {
  scheduleBadge();
  if (tab.active || !/^https?:/.test(tab.pendingUrl || tab.url || "")) return;
  lazyNow.add(tab.id);
  if (!(await getSettings()).lazyBackgroundTabs) return lazyNow.delete(tab.id);
  const { lazy = [] } = await chrome.storage.session.get("lazy");
  await chrome.storage.session.set({ lazy: [...lazy, tab.id] });
});

async function takeLazy(tabId) {
  const inMemory = lazyNow.delete(tabId);
  const { lazy = [] } = await chrome.storage.session.get("lazy");
  if (!inMemory && !lazy.includes(tabId)) return false;
  await chrome.storage.session.set({ lazy: lazy.filter((id) => id !== tabId) });
  return true;
}

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0 || !(await takeLazy(tabId))) return;
  const s = await getSettings();
  if (!s.lazyBackgroundTabs) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && !tab.active && isWebPage(tab)) unload([tab]);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  takeLazy(tabId);
  scheduleBadge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  takeLazy(tabId);
  scheduleBadge();
});

// ---------------------------------------------------------------------------
// Badge: number of loaded tabs. Debounced so a burst of tab events costs one
// query. Tabs Chrome unloads on its own are picked up on the next event/tick.

let badgeTimer;
function scheduleBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadge, 300);
}

async function updateBadge() {
  const s = await getSettings();
  if (!s.showBadge) return chrome.action.setBadgeText({ text: "" });
  const loaded = await chrome.tabs.query({ discarded: false });
  chrome.action.setBadgeBackgroundColor({ color: "#e37400" });
  chrome.action.setBadgeText({ text: String(loaded.length) });
}

// ---------------------------------------------------------------------------
// Shortcuts, context menus, popup messages

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab ||= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  if (command === "unload-selected") actions.selected(tab);
  if (command === "unload-others") actions.others(tab);
});

const MENU = [
  ["tab", "Unload this tab"],
  ["others", "Unload other tabs in this window"],
  ["right", "Unload tabs to the right"],
  ["group", "Unload this tab group"],
  ["site", "Unload all tabs from this site"],
];

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of MENU) {
      chrome.contextMenus.create({ id, title, contexts: ["page", "frame", "action"] });
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab && actions[info.menuItemId]) actions[info.menuItemId](tab);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "unload") return;
  (async () => {
    if (msg.action === "everything") return actions.everything();
    if (msg.action === "tabs") {
      const tabs = await Promise.all(msg.tabIds.map((id) => chrome.tabs.get(id).catch(() => null)));
      return unload(tabs.filter(Boolean));
    }
    const tab = await chrome.tabs.get(msg.tabId);
    return actions[msg.action]?.(tab) ?? 0;
  })().then(reply, () => reply(0));
  return true; // reply asynchronously
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.idleMinutes || changes.maxLoaded) syncAlarm();
  if (changes.showBadge) updateBadge();
});

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
  syncAlarm();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarm();
  updateBadge();
});
