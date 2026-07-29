# Chrome Web Store reviewer test instructions

No account, payment, test credentials, or external service is required.

Helium Command Bar is intended for the Helium Chromium-based browser. Its normal tab search, bookmarks, recently closed, URL opening, preferences, and duplicate cleanup can be reviewed in Chrome or another Chromium browser. Helium-specific internal destinations and split-view behavior require Helium.

Helium is available from:
https://helium.computer/

## Basic test in Chrome or Helium

1. Open two or more normal webpages.
2. Invoke **Open command bar** using its assigned shortcut or the toolbar action.
3. Confirm that a centered overlay lists open tabs, excluding the invoking tab.
4. Type part of another tab's title or URL and select it. Confirm that the existing tab is activated rather than duplicated.
5. Open the extension's Options page and enable or disable Bookmarks and Recently closed results.
6. Reopen the command bar and verify that the selected sections are reflected.
7. Type a URL and press Enter. Confirm that it opens in a new tab.

Protected browser pages reject script injection by design. On such pages the extension falls back to a toolbar-anchored extension popup.

## Bookmark behavior

1. Open the command bar on a normal webpage.
2. Type **Add to Favorites** and select the action.
3. Reopen the command bar and confirm that the tab has a favorite indicator.
4. Type **Remove from Favorites** to remove the bookmark.

The extension changes bookmarks only after either of these explicit actions.

## Optional exact-duplicate cleanup

1. Open the same exact URL in two tabs.
2. In Options, enable **Silently close duplicate tabs**.
3. Invoke the command bar from one duplicate.
4. Confirm that only one tab remains for that exact URL. URLs with different query strings or fragments are not considered duplicates.

## Optional host permission

1. In Options, enable **Highlight the focused split pane**.
2. Confirm that the browser requests optional access to webpages.
3. Disable the setting and confirm that the extension removes the optional permission.

This permission is used only to inject a local, pointer-events-free ring/blur layer. No webpage content is read or transmitted.

## Helium split-view test

1. In Helium, create a native split containing two webpages.
2. Invoke the command bar and confirm the two panes appear as one split block.
3. Activate the **Next split pane** and **Previous split pane** extension commands and confirm that focus moves in the corresponding direction.
4. Invoke **Next tab block** or **Previous tab block** and confirm that navigation skips the other member of the current split.

The enhanced split picker is triggered by Helium's native new-split command. The extension recognizes Helium's temporary split selector and replaces it with a local URL/search picker in that pane.

## Data and network behavior

The extension has no developer-operated backend, analytics, telemetry, advertising, or authentication. Executable code is entirely contained in the extension package. Searches are sent only after an explicit user action to the browser's configured search provider.
