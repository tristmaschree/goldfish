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

// Marker Goldfish can add to unloaded tabs' titles (see background.js).
const MARK = "💤 ";

let current;

async function render() {
  const [s, all] = await Promise.all([getSettings(), chrome.tabs.query({})]);
  [current] = await chrome.tabs.query({ active: true, currentWindow: true });

  const loaded = all.filter((t) => !t.discarded);
  const unloaded = all.filter((t) => t.discarded);
  $("counts").textContent = `${loaded.length} loaded · ${unloaded.length} unloaded`;

  const dupes = findDuplicates(all).length;
  $("dupes-row").hidden = dupes === 0;
  $("dupes-label").textContent = `Close ${dupes} duplicate tab${dupes === 1 ? "" : "s"}`;

  const host = hostOf(current?.url);
  $("protect-row").hidden = !host;
  $("protect-host").textContent = host;
  $("protect").checked = isProtectedHost(host, s.neverUnload);

  const others = loaded
    .filter((t) => t.id !== current?.id)
    .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));
  $("empty").hidden = others.length > 0;
  $("tabs").replaceChildren(
    ...others.map((t) =>
      row(t, s, "Unload", async () => {
        await send({ action: "tabs", tabIds: [t.id] });
      })
    )
  );

  // Unloaded tabs, most recently used first: the ones you're likeliest to want back.
  unloaded.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  $("unloaded-section").hidden = unloaded.length === 0;
  $("unloaded-count").textContent = unloaded.length;
  $("unloaded").replaceChildren(
    ...unloaded.map((t) =>
      // Reloads in the background, so you stay where you are.
      row(t, s, "Reload", () => chrome.tabs.reload(t.id))
    )
  );
}

function row(t, s, label, act) {
  const li = document.createElement("li");

  const icon = document.createElement("img");
  icon.src = favicon(t.url);
  icon.alt = "";

  const name = t.discarded && t.title?.startsWith(MARK) ? t.title.slice(MARK.length) : t.title;
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = name || t.url;
  title.title = `${name}\n${t.url}\n\nClick to switch to this tab`;
  title.onclick = async () => {
    await chrome.tabs.update(t.id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  };

  li.append(icon, title);

  if (t.audible) li.append(tag("playing"));
  else if (t.pinned) li.append(tag("pinned"));
  else if (t.active && !t.discarded) li.append(tag("visible"));
  else if (!t.discarded && isProtectedHost(hostOf(t.url), s.neverUnload)) li.append(tag("protected"));

  const age = document.createElement("span");
  age.className = "age";
  age.textContent = t.active && !t.discarded ? "" : ago(t.lastAccessed);
  li.append(age);

  const btn = document.createElement("button");
  btn.textContent = label;
  btn.onclick = async () => {
    btn.disabled = true;
    await act();
    render();
  };
  li.append(btn);

  return li;
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

// Remember whether the unloaded list was left open (just a convenience).
const section = $("unloaded-section");
try {
  section.open = localStorage.getItem("unloadedOpen") === "1";
} catch {}
section.ontoggle = () => {
  try {
    localStorage.setItem("unloadedOpen", section.open ? "1" : "0");
  } catch {}
};

render();
