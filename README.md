# Helium Command Bar

A small Manifest V3 extension that gives Helium an Arc-like, keyboard-driven command bar centered over the current page:

- open as a centered overlay instead of a toolbar-anchored popup;
- fuzzy-search every open or recently closed tab by title or URL;
- present split views as one keyboard-selectable block with both panes visible;
- switch to a tab or split view in any window;
- restore useful recently closed tabs and windows while hiding built-in settings and empty new-tab placeholders;
- enter a URL and open it when there are no tab matches;
- search with Helium's default search provider;
- find and open Helium settings destinations such as **Keyboard shortcuts**;
- press **Command/Ctrl + Enter** to always open the input in a new tab;
- close the selected tab with **Command/Ctrl + Backspace**;
- enhance Helium's native **New split tab** command with URL and web-search input;
- switch directly between panes and navigate the tab strip in split-aware blocks;
- restore the last-focused pane whenever keyboard navigation enters a split.

## Install in Helium

1. Open `chrome://extensions` in Helium.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. The extension bridge is **Command + Shift + Space** on macOS or **Ctrl + Shift + Space** elsewhere.
5. On macOS, follow the Karabiner workflow below to use **Command + T** as the default user-facing command-bar shortcut.

Chromium will not automatically assign an extension directly to its built-in **Command + T** shortcut. The core Karabiner rule safely translates **Command + T** to the automatically assigned **Command + Shift + Space** bridge instead. If the bridge is unavailable or conflicts with another extension, open `chrome://extensions/shortcuts` and restore it before importing the Karabiner rule.

## Keyboard navigation and Karabiner-Elements

The extension includes commands to switch split panes, move to the next or previous tab block, and select tab blocks 1–9. A normal tab is one block and every split is one block, so block navigation never stops on the other pane of the current split. Entering a split restores its last-focused pane.

Open the extension's **Options** page to inspect active command assignments and import the repository's Karabiner-Elements rules. The rules are split into two files so native numbered navigation is never intercepted before its extension bridges are ready:

- [`integrations/karabiner-core.json`](integrations/karabiner-core.json) provides **Command + T** for the command bar, **Option + T** for Helium's native new-split command, **Control + Tab** / **Control + Shift + Tab** for block navigation, and **Control + H/L** for split-pane switching.
- [`integrations/karabiner-numbered-navigation.json`](integrations/karabiner-numbered-navigation.json) optionally maps **Command + 1–9** to split-aware numbered block commands.

Karabiner asks which rules to enable and scopes all of them to Helium's `net.imput.helium` bundle ID. The four core extension bridges have manifest defaults, so they normally require no manual shortcut setup.

The recommended macOS command-bar workflow is:

```text
Command + T → Karabiner → Command + Shift + Space → Open command bar
```

This makes **Command + T** the default user-facing command without relying on Chromium to assign a protected browser shortcut. Enabling the rule replaces Helium's normal new-tab behavior; use the command bar to open a URL or search instead.

Chromium permits only four suggested shortcuts per extension, so numbered commands remain unassigned by default. Assign **Option + Shift + 1–9** under `helium://extensions/shortcuts`; the Options page enables the numbered Karabiner import only after all nine exact bridge shortcuts are detected. Until then, native **Command + 1–9** remains untouched.

### Migrating from Split Block Navigation

Disable the standalone **Split Block Navigation** extension before configuring this unified extension; otherwise it may continue to own the same bridge shortcuts. Reload Helium Command Bar, open its Options page, and confirm that all four core rows show the expected shortcuts before importing the core Karabiner rules. Existing custom assignments are never overwritten automatically.

## Important limitation

Chromium does not expose its built-in **Search Tabs** bubble to extensions, so an extension cannot add an action to or replace that native UI directly. This extension is a separate command bar that can be bound to a nearby shortcut and used instead.

The command bar is injected in an isolated JavaScript world and rendered inside a closed Shadow DOM on normal web pages. No extension page is exposed as a web-accessible resource.

Chromium forbids injection on protected pages such as `chrome://` URLs and the Chrome Web Store. On those pages, the extension falls back to the original browser-anchored popup—never a separate OS window. Chromium does not permit extensions to place a centered overlay over browser-owned pages.

## Usage

- Results are grouped into **Open**, **Bookmarks**, and **Recently closed** sections, in that order. A **Search** section appears above them only after you start typing and includes matching Helium settings destinations.
- **Bookmarks** are read from your browser bookmarks and retain their cached site favicon without an extra star badge. Type **Add to Favorites** or **Remove from Favorites** to update the current page's bookmark. A bookmark already open in any window appears only under **Open**, never under **Bookmarks**, but continues to use its custom bookmark name and gains a right-aligned star indicator.
- Start typing to filter open tabs, bookmarks, and recently closed tabs. Exact URL host/path components are ranked above partial URL matches—for example, `github.com/tempoxyz/tempo` outranks `github.com/tempoxyz/zones` for `tempo`.
- The tab from which the command bar was invoked is omitted from **Open**. Type **Pin tab** or **Unpin tab** to change its pinned state. Pinned results use a right-aligned Arc-style pushpin indicator.
- Enter hints appear only on the selected result. Open-tab rows show a close button only while hovered and not selected; the selected row shows its Enter hint instead.
- Redundant site branding is removed from displayed tab titles—for example, `GitHub - imputnet/helium` is shown as `imputnet/helium`. Bookmark names take precedence for open favorites. Fuzzy search still uses the original page title, bookmark name, and URL, so searching for `github` continues to find them.
- Split views are always selected as one block first. Press **Right Arrow** to enter individual tab navigation and **Left Arrow** to return to the complete group. Compact mode also expands and collapses the visual rows; expanded mode keeps both rows visible while entering or exiting their navigation. A search matching either pane keeps both entries visible.
- Recently closed results are marked **Restore**; selecting one restores the tab or closed window.
- Press **Up/Down** to select an item and **Enter** to activate or restore it.
- As soon as you type, opening the URL or searching with the default search engine is always the first selected option.
- Press **Enter** to use that first option, or **Down** to choose a matching open/recently closed tab.
- Press **Command/Ctrl + Enter** to open the input directly regardless of the current selection; this shortcut is shown on the open/search option.
- Press **Command/Ctrl + Backspace** to close the selected tab.
- Type **Settings** to open `helium://settings`, **Keyboard shortcuts** (or **hotkeys**) to open `helium://settings/system/shortcuts`, **Extensions** (also **add-ons** or **plugins**) to open `helium://extensions`, or **Manage bookmarks** to open `helium://bookmarks`.
- Open Settings, Keyboard shortcuts, Extensions, and bookmark-manager tabs are omitted from the regular **Open** section. Searching for their destination shows the dedicated icon and focuses the existing tab instead of opening a duplicate.

Bare domains such as `example.com`, localhost URLs, IP addresses, and explicit `http://` or `https://` URLs are opened directly. Other text is sent to the browser's default search provider.

Split-tab detection uses Chromium's `tabs.Tab.splitViewId` API, available in Chromium 140 and newer. The rest of the extension continues to work on older Chromium versions, where split panes appear as ordinary tabs.

## Enhanced new split picker

Invoke Helium's native **New split tab** command—**Command + Option + N** by default on macOS. The extension automatically detects the temporary native split selector and opens its enhanced picker in that pane.

The enhanced picker uses the same result model as the regular command bar:

- Enter a URL to navigate the new split pane directly.
- Enter ordinary text to search with Helium's default search provider in that pane.
- Select an **open tab** result to load a copy of its URL in the split; the original tab remains open and unchanged.
- Select a **recently closed** result to reopen its page directly in the split.
- Press **Escape** to cancel and close the temporary split pane.

Helium's native selector is not shown. Because Chromium does not expose its internal “move existing tab into split” operation to extensions, open-tab results copy the page URL rather than moving the original tab and its live state.

This remains a single-keybind workflow: the keybind belongs to Helium's native command so that the browser creates the actual split before the extension takes over the temporary pane.

## Settings

Open the extension's **Options** page by right-clicking its toolbar icon, or from its details page on `chrome://extensions`.

The **Command bar color** setting accepts any color and includes Neutral, Purple, Blue, Green, and Orange presets. Neutral black/gray (`#505156`) is the default and colors both the regular command bar and enhanced split picker.

The **Result sections** settings let you independently show or hide **Bookmarks** and **Recently closed**. Bookmarks can include all bookmark folders or a selected set of folders; selecting a parent folder selects its current descendants.

The **Default split view appearance** setting controls whether splits initially open in:

- **Compact** mode: one selected block with two side-by-side tab summaries.
- **Expanded** mode: both full rows are visible immediately, but the complete wrapper is selected first.

Press **Right Arrow** from either default to enter the individual rows, and **Left Arrow** to return to group selection. This navigation state is temporary for the current command-bar session. The saved default is synced through Chromium's extension storage.

The optional **Highlight the focused split pane** setting adds a persistent bold dark ring with a soft inward fade. The unfocused pane remains unchanged normally and receives the blur treatment only while the command bar is open. Switching pane focus moves the ring immediately. It is disabled by default and requests host access when enabled; protected browser pages remain unchanged.

## Development

There is no build step. Edit the files and click the extension's reload button on `chrome://extensions`.

Run the pure search/URL tests with:

```sh
npm test
```

## Permissions

- `activeTab` and `scripting`: show the isolated command-bar overlay over the current page only when explicitly invoked.
- `tabs`: read open-tab titles and URLs and activate/close selected tabs.
- `bookmarks`: read browser bookmarks for the **Bookmarks** section and add/remove a bookmark only when the corresponding command-bar action is selected.
- `favicon`: retrieve browser-cached site icons for bookmark results. Only Chromium's `_favicon` endpoint is exposed to webpages so content-script results can load cached icons; no extension HTML or JavaScript is web-accessible.
- `sessions`: list and restore recently closed tabs and windows.
- `search`: query Helium's configured default search provider.
- `storage`: sync command-bar preferences and remember the last-focused pane of each split for the current browser session.
- Optional `<all_urls>` host access: inject only the persistent focus ring and temporary inactive-pane blur into split panes. This permission is requested explicitly when the setting is enabled and removed again when it is disabled.
