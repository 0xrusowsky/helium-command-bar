# Chrome Web Store listing draft

## Product name

Helium Command Bar

## Summary

Keyboard-driven tab search, split navigation, favorites, and recently closed tabs for the Helium browser.

## Category

Productivity

## Language

English

## Detailed description

Helium Command Bar adds a fast, keyboard-driven command bar and split-aware tab navigation to the Helium browser.

Search open tabs, bookmarks, and recently closed pages from one centered interface. Open URLs or use Helium's configured search provider without reaching for the mouse. Split views appear as a single tab block while still allowing direct pane navigation.

Features include:

- Search and switch to open tabs across windows.
- Search browser bookmarks and mark the current page as a favorite.
- Restore recently closed tabs and windows.
- Navigate Helium split views as complete tab blocks.
- Move left or right between panes in a split.
- Open URLs and submit searches from the command bar.
- Optionally close exact duplicate URLs whenever the command bar opens.
- Customize result ordering, split presentation, and command-bar color.
- Optionally emphasize the focused split pane with a local visual effect.
- Use the included Karabiner-Elements integration for Command-T, Control-Tab, Control-H/L, and related shortcuts on macOS.

The extension is designed for Helium. Most ordinary tab-search behavior also works in Chromium, but Helium-specific internal pages and split navigation require Helium and a Chromium version that exposes the split-view tab API.

Helium Command Bar contains no analytics, advertising, or telemetry. Tab and bookmark information is processed locally and is not sent to the developer.

Project and setup instructions:
https://github.com/0xrusowsky/helium-command-bar

Privacy policy:
https://github.com/0xrusowsky/helium-command-bar/blob/main/PRIVACY.md

## Single purpose

Provide keyboard-driven tab search, activation, cleanup, restoration, and split-view navigation for the Helium browser.

## Privacy disclosures

The extension does not collect or transmit user data to the developer or any developer-operated service. It locally processes browsing activity required for its visible functionality: open-tab titles and URLs, bookmarks, recently closed sessions, and user-entered command-bar text. Browser sync may synchronize extension preferences under the user's browser-account settings.

A user-submitted search is sent only to the search provider configured in the browser. A user-opened URL is requested normally by the browser.

## Suggested Privacy-tab data disclosures

Disclose **Web history** because the extension locally handles tab URLs, titles, activation metadata, and recently closed sessions. Disclose **User activity** because it locally handles bookmarks, user-entered command-bar input, and explicit tab-management actions. State that both categories are used only for the extension's visible tab-management purpose and are not sent to the developer.

Do not select **Website content** unless the dashboard's current wording requires it for tab titles or URLs. The extension does not inspect page text, forms, cookies, request bodies, responses, or browser storage. Review the dashboard's current definitions when submitting, because Google can change these categories.

Certify all applicable Limited Use statements: no sale, no use unrelated to the single purpose, no creditworthiness or lending use, and no human access except where explicitly permitted by policy. The extension has no developer backend and therefore provides no developer access to this data.

## Permission justifications

### activeTab

Used only after the user invokes the extension, allowing the command-bar overlay to be inserted into the active page.

### bookmarks

Reads bookmarks for the Bookmarks results section and creates or removes a bookmark only when the user chooses Add to Favorites or Remove from Favorites.

### favicon

Loads browser-cached favicons for bookmark and tab results. Favicons are not sent to the developer.

### scripting

Injects the command-bar overlay into the active page. When the separately enabled optional webpage permission is present, it also injects the pointer-events-free split focus/blur layer.

### search

Submits text to the browser's configured default search provider only when the user explicitly chooses to search.

### sessions

Reads recently closed tabs and windows for display and restores an item only when selected by the user.

### storage

Stores appearance, result-ordering, duplicate-cleanup, setup, and split-navigation preferences. It does not store browsing history for developer access.

### tabs

Reads open-tab metadata needed for search and split grouping, activates selected tabs, closes tabs requested by the user or the optional exact-duplicate cleanup setting, and updates the temporary pane used by the enhanced split picker.

### Optional host permission: `<all_urls>`

Requested only when the user enables Highlight the focused split pane. It permits injection of a local, pointer-events-free visual ring/blur layer into split panes. The layer does not read or transmit page content. The permission is removed when the feature is disabled.

## Remote code declaration

No remotely hosted code is used. All executable JavaScript and CSS is included in the uploaded package. The settings page contains a user-initiated link to a static Karabiner JSON file in the public GitHub repository; the extension neither evaluates nor executes that file.

## Support URL

https://github.com/0xrusowsky/helium-command-bar/issues
