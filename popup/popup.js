import { getSettings, setSettings, hostOf, isProtectedHost } from "../src/settings.js";
import { findDuplicates } from "../src/duplicates.js";

const $ = (id) => document.getElementById(id);

const send = (msg) => chrome.runtime.sendMessage({ type: "unload", ...msg });

function favicon(url) {
  const u = new URL(chrome.runtime.getURL("/_favicon/"));
  u.searchParams.set("pageUrl", url || "");
  u.searchParams.set("size", "16");
  return u.href;
}

function ago(ms) {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

let current;

async function render() {
  const [s, all, { unloadedDay, unloadedToday = 0 }] = await Promise.all([
    getSettings(),
    chrome.tabs.query({}),
    chrome.storage.local.get(["unloadedDay", "unloadedToday"]),
  ]);
  [current] = await chrome.tabs.query({ active: true, currentWindow: true });

  const loaded = all.filter((t) => !t.discarded);
  $("counts").textContent = `${loaded.length} loaded · ${all.length - loaded.length} unloaded`;
  // Counts every unload, so the same tab unloaded twice counts twice.
  const today = unloadedDay === new Date().toDateString() ? unloadedToday : 0;
  $("total").textContent = today ? `Unloaded ${today.toLocaleString()} tab${today === 1 ? "" : "s"} today` : "";

  const dupes = findDuplicates(all).length;
  $("dupes-row").hidden = dupes === 0;
  $("dupes-label").textContent = `Close ${dupes} duplicate tab${dupes === 1 ? "" : "s"}`;

  const host = hostOf(current?.url);
  $("protect-row").hidden = !host;
  $("protect-host").textContent = host;
  $("protect").checked = isProtectedHost(host, s.neverUnload);

  const list = $("tabs");
  list.replaceChildren();
  const others = loaded
    .filter((t) => t.id !== current?.id)
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
  $("empty").hidden = others.length > 0;

  for (const t of others) {
    const li = document.createElement("li");

    const icon = document.createElement("img");
    icon.src = favicon(t.url);
    icon.alt = "";

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = t.title || t.url;
    title.title = `${t.title}\n${t.url}\n\nClick to switch to this tab`;
    title.onclick = async () => {
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
    };

    li.append(icon, title);

    if (t.audible) li.append(tag("playing"));
    else if (t.pinned) li.append(tag("pinned"));
    else if (t.active) li.append(tag("visible"));
    else if (isProtectedHost(hostOf(t.url), s.neverUnload)) li.append(tag("protected"));

    const age = document.createElement("span");
    age.className = "age";
    age.textContent = t.active ? "" : ago(t.lastAccessed);
    li.append(age);

    const btn = document.createElement("button");
    btn.textContent = "Unload";
    btn.onclick = async () => {
      btn.disabled = true;
      await send({ action: "tabs", tabIds: [t.id] });
      render();
    };
    li.append(btn);

    list.append(li);
  }
}

function tag(text) {
  const el = document.createElement("span");
  el.className = `tag ${text}`;
  el.textContent = text;
  return el;
}

async function run(action) {
  if (!current) return;
  await send({ action, tabId: current.id });
  render();
}

$("unload-tab").onclick = () => run("tab");
$("unload-others").onclick = () => run("others");
$("unload-everything").onclick = async () => {
  await send({ action: "everything" });
  render();
};

$("close-dupes").onclick = async () => {
  await send({ action: "duplicates" });
  render();
};

$("protect").onchange = async (e) => {
  const host = hostOf(current?.url);
  if (!host) return;
  const { neverUnload } = await getSettings();
  const next = e.target.checked
    ? [...new Set([...neverUnload, host])]
    : neverUnload.filter((h) => h !== host && !host.endsWith(`.${h}`));
  await setSettings({ neverUnload: next });
};

$("settings").onclick = () => chrome.runtime.openOptionsPage();

render();
