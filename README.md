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
4. The extension command bridge is **Command + Shift + Space** on macOS or **Ctrl + Shift + Space** elsewhere. Keep the Helium shortcut assignment that is already working in your setup.
5. Reload the extension after installation and confirm **Move the current preview tab into the main Helium window** is assigned **Command + Control + O** at `helium://extensions/shortcuts`. It now uses one of Chromium's four suggested-shortcut slots. The previous tab-block command remains available, but may need its existing shortcut re-confirmed manually if Chromium does not retain it. Hammerspoon uses the promotion command as the internal bridge for **Command + O** in Little Helium previews.

## Keyboard navigation and Karabiner-Elements

The extension includes commands to switch split panes and move to the next or previous tab block. A normal tab is one block and every split is one block, so block navigation never stops on the other pane of the current split. Entering a split restores its last-focused pane.

Control-Tab navigation opens a centered, input-free tab viewer showing every open block in the current window in tab-strip order. Without releasing Control, press Tab and Shift-Tab in any order to move forward and backward through the selection. The viewer uses the command bar's color theme, remains open for as long as Control is held, and switches only when Control is released, Enter is pressed, or a row is clicked. Hover or select a tab and press **D**, **Delete**, or **Backspace** to close it without dismissing the viewer. Escape cancels. Protected browser pages that reject extension injection retain immediate block navigation without the viewer.

The current macOS setup keeps Helium-specific keyboard translations in Hammerspoon at `~/.hammerspoon/helium-keyboard.lua`. The event tap only consumes them while Helium is frontmost:

- **Command + Shift + P** aliases **Command + T** inside Helium for the command bar.
- **Option + T** sends Helium's native **Command + Option + N** new-split command.
- **Control + Tab** / **Control + Shift + Tab** navigate next/previous split-aware tab blocks.
- **Control + J/K** are next/previous tab-block aliases.
- **Control + H/L** switch between split panes.
- **Control + 1/2** focus or launch the work and personal Helium profiles.

The extension's command assignments remain configurable at `helium://extensions/shortcuts`; existing custom assignments are not overwritten automatically. The repository still includes optional Karabiner-Elements support in [`integrations/karabiner-core.json`](integrations/karabiner-core.json) for users who prefer Karabiner instead of Hammerspoon. Do not enable both sets of Helium-specific translations at the same time. Karabiner remains available for unrelated device or keyboard-layout remapping.

### Migrating from Split Block Navigation

Disable the standalone **Split Block Navigation** extension before using the unified extension; otherwise it may continue to own the same navigation shortcuts.

## Important limitation

Chromium does not expose its built-in **Search Tabs** bubble to extensions, so an extension cannot add an action to or replace that native UI directly. This extension is a separate command bar that can be bound to a nearby shortcut and used instead.

The command bar is injected in an isolated JavaScript world and rendered inside a closed Shadow DOM on normal web pages. No extension page is exposed as a web-accessible resource.

Chromium forbids injection on protected pages such as `chrome://` URLs and the Chrome Web Store. On those pages, the extension falls back to the original browser-anchored popup—never a separate OS window. Chromium does not permit extensions to place a centered overlay over browser-owned pages.

## Usage

- Results are grouped into **Open**, **Bookmarks**, and **History** sections, in that order. History combines recently closed tabs with matching URLs from the browser's full history without duplicates. A **Search** section appears above them after you type and includes matching Helium settings destinations.
- **Bookmarks** are read from your browser bookmarks and retain their cached site favicon without an extra star badge. Type **Add to Favorites** or **Remove from Favorites** to update the current page's bookmark. A bookmark already open in any window appears only under **Open**, never under **Bookmarks**, but continues to use its custom bookmark name and gains a right-aligned star indicator.
- Start typing to filter open tabs, bookmarks, recently closed tabs, and the browser's full URL history. Exact URL host/path components are ranked above partial URL matches—for example, `github.com/tempoxyz/tempo` outranks `github.com/tempoxyz/zones` for `tempo`.
- The tab from which the command bar was invoked is omitted from **Open**. Type **Pin tab** or **Unpin tab** to change its pinned state. Pinned results use a right-aligned Arc-style pushpin indicator.
- Enter hints appear only on the selected result. Open-tab rows show a close button only while hovered and not selected; the selected row shows its Enter hint instead.
- Redundant site branding is removed from displayed tab titles—for example, `GitHub - imputnet/helium` is shown as `imputnet/helium`. Bookmark names take precedence for open favorites. Fuzzy search still uses the original page title, bookmark name, and URL, so searching for `github` continues to find them.
- Split views are always selected as one block first. Press **Right Arrow** to enter individual tab navigation and **Left Arrow** to return to the complete group. Compact mode also expands and collapses the visual rows; expanded mode keeps both rows visible while entering or exiting their navigation. A search matching either pane keeps both entries visible.
- History results have one consistent appearance. When Chromium can restore a recently closed tab or window, the command bar does so automatically; otherwise it reopens the URL.
- Press **Up/Down** to select an item and **Enter** to activate or restore it.
- Press **Control + Tab** or **Control + Shift + Tab** to open the tab viewer, cycle through split-aware blocks, and switch when Control is released.
- As soon as you type, opening the URL or searching with the default search engine is always the first selected option.
- Press **Enter** to use that first option, or **Down** to choose a matching open/recently closed tab.
- Press **Command/Ctrl + Enter** to open the input directly regardless of the current selection; this shortcut is shown on the open/search option.
- Press **Command/Ctrl + Backspace** to close the selected tab.
- The **Move the current preview tab into the main Helium window** command uses `chrome.tabs.move` to preserve the live page when the Little Helium preview receives **Command + O**.
- Type **Settings** to open `helium://settings`, **Keyboard shortcuts** (or **hotkeys**) to open `helium://settings/system/shortcuts`, **Extensions** (also **add-ons** or **plugins**) to open `helium://extensions`, or **Manage bookmarks** to open `helium://bookmarks`. Press **Right Arrow** on **Extensions** to reveal the Helium Command Bar settings, then **Left Arrow** to collapse it.
- At browser startup, and otherwise at most once per day when using any extension shortcut, the extension checks whether its unpacked files contain a newer manifest version. When they do, **Update extension** appears as the command bar's first option and reloads the extension—the same action as the reload button on `helium://extensions`.
- Open extension settings, browser Settings, Keyboard shortcuts, Extensions, and bookmark-manager tabs are omitted from the regular **Open** section. Their command-bar destinations focus an existing tab instead of opening a duplicate.

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

The **Arc-like Helium setup** checklist links directly to Helium's protected startup and appearance settings. It guides users through restoring their workspace and enabling frameless mode with the vertical sidebar. The extension cannot inspect or change those browser-owned preferences, so completion marks are user-confirmed and stored in extension sync storage.

The **Command bar color** setting accepts any color and includes Neutral, Purple, Blue, Green, and Orange presets. Neutral black/gray (`#505156`) is the default. The selected color themes the command bar, tab viewer, enhanced split picker, extension settings, and toolbar icon. The manifest icons use the redesigned neutral split-search logo as their stable fallback.

The **Result sections** settings let you reorder **Open tabs**, **Bookmarks**, and **Recently closed**, so favorites can appear before open tabs. You can also independently show or hide **Bookmarks** and **Recently closed**. Bookmarks can include all bookmark folders or a selected set of folders; selecting a parent folder selects its current descendants.

The optional **Silently close duplicate tabs** setting cleans up duplicate tabs across all windows whenever an extension shortcut is used. Matching is exact and includes the complete query string and fragment. The focused tab is preserved; for unrelated duplicate groups, pinned, active, and most recently accessed tabs are preferred in that order.

The optional **Silently close unfocused New Tab tabs** setting removes unused New Tab pages on the same shortcut activations while always preserving the currently focused tab.

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

Build a tested Chrome Web Store ZIP with:

```sh
npm run package
```

The archive is written to `dist/` from an explicit runtime-file allowlist. Store listing copy, reviewer instructions, asset requirements, and the release checklist are in [`store/`](store/). See [`PRIVACY.md`](PRIVACY.md) for the extension privacy policy.

## Permissions

- `activeTab` and `scripting`: show the isolated command-bar overlay over the current page only when explicitly invoked.
- `tabs`: read open-tab titles and URLs and activate/close selected tabs.
- `bookmarks`: read browser bookmarks for the **Bookmarks** section and add/remove a bookmark only when the corresponding command-bar action is selected.
- `history`: search previously visited URLs after text is entered in the command bar.
- `favicon`: retrieve browser-cached site icons for bookmark results. Only Chromium's `_favicon` endpoint is exposed to webpages so content-script results can load cached icons; no extension HTML or JavaScript is web-accessible.
- `sessions`: list and restore recently closed tabs and windows.
- `search`: query Helium's configured default search provider.
- `storage`: sync command-bar preferences, including optional duplicate-tab cleanup, and remember the last-focused pane of each split for the current browser session.
- Optional `<all_urls>` host access: inject only the persistent focus ring and temporary inactive-pane blur into split panes. This permission is requested explicitly when the setting is enabled and removed again when it is disabled.
