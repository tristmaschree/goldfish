// Settings shared by the service worker, popup and options page.
// Stored in chrome.storage.sync so they follow you between machines.

export const DEFAULTS = {
  // Unload tabs that haven't been looked at for this many minutes (0 = off).
  idleMinutes: 30,
  // Keep at most this many tabs loaded across all windows (0 = no limit).
  maxLoaded: 0,
  // Unload when a tab group is collapsed.
  unloadCollapsedGroups: true,
  // Tabs opened in the background (Cmd/Ctrl-click) stay unloaded until you view them.
  lazyBackgroundTabs: false,
  // Unload everything eligible when the screen locks.
  unloadOnLock: false,
  // Never unload pinned tabs.
  keepPinned: true,
  // Hostnames that are never unloaded (subdomains included).
  neverUnload: ["mail.google.com", "calendar.google.com", "meet.google.com"],
};

export async function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

export function setSettings(patch) {
  return chrome.storage.sync.set(patch);
}

export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
  } catch {
    return "";
  }
}

// True if `host` is on the never-unload list (exact match or a subdomain of an entry).
export function isProtectedHost(host, list) {
  if (!host) return false;
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}
