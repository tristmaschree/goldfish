// Duplicate tabs: tabs showing the same page, apart from the #fragment.
// Shared by the service worker (which closes them) and the popup (which
// shows how many there are).

function pageKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") return "";
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
}

// Which copy of a page to keep: the one you're looking at, then a pinned
// one, then one that's still loaded, then the most recently used.
function keepScore(t) {
  return [t.active ? 1 : 0, t.pinned ? 1 : 0, t.discarded ? 0 : 1, t.lastAccessed || 0];
}

function better(a, b) {
  const sa = keepScore(a);
  const sb = keepScore(b);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i] ? a : b;
  return a;
}

// Returns the tabs to close: every copy but one of each page. Pinned tabs and
// tabs playing audio are never closed.
export function findDuplicates(tabs) {
  const byPage = new Map();
  for (const t of tabs) {
    const key = pageKey(t.url || t.pendingUrl);
    if (!key) continue;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(t);
  }
  const extra = [];
  for (const copies of byPage.values()) {
    if (copies.length < 2) continue;
    const keep = copies.reduce(better);
    extra.push(...copies.filter((t) => t !== keep && !t.pinned && !t.audible));
  }
  return extra;
}
