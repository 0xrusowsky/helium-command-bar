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
- enhance Helium's native **New split tab** command with URL and web-search input.

## Install in Helium

1. Open `chrome://extensions` in Helium.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Press **Command + Shift + Space** on macOS or **Ctrl + Shift + Space** elsewhere.

If the shortcut is unavailable or conflicts with another app, open `chrome://extensions/shortcuts` and assign a different shortcut to **Helium Command Bar**.

## Important limitation

Chromium does not expose its built-in **Search Tabs** bubble to extensions, so an extension cannot add an action to or replace that native UI directly. This extension is a separate command bar that can be bound to a nearby shortcut and used instead.

The command bar is injected in an isolated JavaScript world and rendered inside a closed Shadow DOM on normal web pages. No extension page is exposed as a web-accessible resource.

Chromium forbids injection on protected pages such as `chrome://` URLs and the Chrome Web Store. On those pages, the extension falls back to the original browser-anchored popup—never a separate OS window. Chromium does not permit extensions to place a centered overlay over browser-owned pages.

## Usage

- Results are grouped into **Open** and **Recently closed** sections. A **Search** section appears above them only after you start typing and includes matching Helium settings destinations.
- Start typing to filter open and recently closed tabs.
- Split views are always selected as one block first. Press **Right Arrow** to enter individual tab navigation and **Left Arrow** to return to the complete group. Compact mode also expands and collapses the visual rows; expanded mode keeps both rows visible while entering or exiting their navigation. A search matching either pane keeps both entries visible.
- Recently closed results are marked **Restore**; selecting one restores the tab or closed window.
- Press **Up/Down** to select an item and **Enter** to activate or restore it.
- As soon as you type, opening the URL or searching with the default search engine is always the first selected option.
- Press **Enter** to use that first option, or **Down** to choose a matching open/recently closed tab.
- Press **Command/Ctrl + Enter** to open the input directly regardless of the current selection; this shortcut is shown on the open/search option.
- Press **Command/Ctrl + Backspace** to close the selected tab.
- Type **Settings** to open `helium://settings`, **Keyboard shortcuts** (or **hotkeys**) to open `helium://settings/system/shortcuts`, or **Extensions** (also **add-ons** or **plugins**) to open `helium://extensions`.
- Open Settings, Keyboard shortcuts, and Extensions tabs are omitted from the regular **Open** section. Searching for their destination shows the dedicated icon and focuses the existing tab instead of opening a duplicate.

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
- `sessions`: list and restore recently closed tabs and windows.
- `search`: query Helium's configured default search provider.
- `storage`: sync the selected split appearance and inactive-pane preference.
- Optional `<all_urls>` host access: inject only the persistent focus ring and temporary inactive-pane blur into split panes. This permission is requested explicitly when the setting is enabled and removed again when it is disabled.
