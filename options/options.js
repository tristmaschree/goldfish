import { DEFAULTS, getSettings, setSettings } from "../src/settings.js";

const $ = (id) => document.getElementById(id);
let savedTimer;

function saved() {
  $("saved").textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

function parseHosts(text) {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((line) => line.trim().toLowerCase())
        .map((line) => line.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
        .filter(Boolean)
    ),
  ];
}

async function load() {
  const s = await getSettings();
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const el = $(key);
    if (!el) continue;
    if (typeof value === "boolean") el.checked = s[key];
    else if (Array.isArray(value)) el.value = s[key].join("\n");
    else el.value = String(s[key]);
  }
}

for (const [key, value] of Object.entries(DEFAULTS)) {
  const el = $(key);
  if (!el) continue;
  if (typeof value === "boolean") {
    el.onchange = () => setSettings({ [key]: el.checked }).then(saved);
  } else if (Array.isArray(value)) {
    el.onchange = () => {
      const hosts = parseHosts(el.value);
      el.value = hosts.join("\n");
      setSettings({ [key]: hosts }).then(saved);
    };
  } else {
    el.onchange = () => setSettings({ [key]: Number(el.value) }).then(saved);
  }
}

$("shortcuts").onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
};

// Keep in sync if the popup changes the never-unload list while this is open.
chrome.storage.onChanged.addListener((_changes, area) => area === "sync" && load());

load();
