# Goldfish

Makes your chrome better by giving it the memory of a goldfish.

Chrome only unloads tabs on its own schedule, after they've sat idle for a while. Goldfish lets you say "I'm done with this for now" and unload a tab **right away**. The tab stays in your tab strip, and clicking it reloads the page.

It uses `chrome.tabs.discard`, the same mechanism as Chrome's built-in Memory Saver. An unloaded tab's page process is shut down, which frees its memory and CPU.

## Features

**Unload on demand**
- <kbd>⌥ Option</kbd> <kbd>⇧ Shift</kbd> <kbd>U</kbd>: unload the current tab, or every selected tab (Cmd/Shift-click tabs to select several)
- <kbd>⌥ Option</kbd> <kbd>⇧ Shift</kbd> <kbd>O</kbd>: unload the other tabs in this window
- Right-click a page or the toolbar icon to unload: this tab, other tabs, tabs to the right, this tab group, or every tab from this site
- The popup lists your loaded tabs, least recently used first, with one-click unloading

**Close duplicate tabs**
- When the same page is open in more than one tab, the popup offers to close the extra copies. It's also in the right-click menu.
- It keeps the copy you're looking at, then a pinned copy, then one that's still loaded, then the most recently used. Pinned tabs and tabs playing audio are never closed, and links to different parts of the same page (`#section`) count as the same page.
- Closed a tab you wanted? <kbd>⌘</kbd> <kbd>⇧ Shift</kbd> <kbd>T</kbd> brings it back.

**Unload automatically** (configurable in Settings)
- Tabs you haven't looked at for 30 minutes (adjustable)
- Optional cap on how many tabs stay loaded
- Collapsing a tab group unloads its tabs
- Optional: tabs opened in the background (Cmd-click) don't load until you open them
- Optional: unload idle tabs when your screen locks

**Never unloaded automatically:** the tab you're looking at, tabs playing audio, pinned tabs (configurable), and sites on your never-unload list (Gmail, Calendar and Meet by default).

## Lightweight by design

An extension meant to save resources shouldn't use many itself:

- **No content scripts.** Nothing is injected into the pages you visit.
- **Event-driven service worker.** Chrome shuts it down when idle, so it uses no memory between events.
- **Infrequent timer.** The idle check runs at most once a minute, and less often with longer timeouts.
- **Favicons come from Chrome's local cache**, so the popup makes no network requests.
- **No network access at all.** No host permissions, analytics or remote code.

You can check its cost in Chrome's Task Manager (<kbd>⌘</kbd> + <kbd>Esc</kbd> on Mac, or Window → Task Manager): "Extension: Goldfish" usually isn't listed at all, because it isn't running.

## Install (from source)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repo folder.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read tab URLs and titles for the popup list and per-site rules |
| `tabGroups` | Unload a group when it's collapsed |
| `webNavigation` | Detect when a background tab starts loading (lazy background tabs) |
| `idle` | Detect screen lock |
| `alarms` | Periodic idle-tab check |
| `contextMenus` | Right-click menu items |
| `storage` | Your settings |
| `favicon` | Show tab icons in the popup from Chrome's cache |

## Limitations

- Chrome doesn't let extensions add items to the tab strip's own right-click menu. Use the shortcut, the page right-click menu, or the popup instead.
- Lazy background tabs are unloaded before they finish loading, so they may show a URL instead of a title, and no icon, until you open them.
- Unloading can lose unsaved state on some pages, such as text typed into a form or a video's playback position. Add those sites to the never-unload list.
- Extensions can't read how much memory each tab uses, so Goldfish decides what to unload by how recently you've used each tab.

## License

MIT
