import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESULT_SECTION_ORDER,
  attachBookmarkMetadata,
  bookmarkUrlKey,
  buildTabBlocks,
  cleanTabTitle,
  displayTabTitle,
  duplicateTabIds,
  filterBookmarks,
  filterRecentlyClosed,
  filterSettings,
  filterTabActions,
  filterTabBlocks,
  filterTabs,
  flattenBookmarks,
  getSettingById,
  getSettingForTab,
  isIgnoredRecentlyClosedTab,
  isSplitTab,
  normalize,
  normalizeResultSectionOrder,
  resolveInput,
  scoreTab,
  sessionToItem
} from "../search.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  commandBarThemeCss,
  normalizeThemeColor
} from "../theme.js";

const tabs = [
  { id: 1, title: "GitHub · Dashboard", url: "https://github.com/", lastAccessed: 10 },
  { id: 2, title: "Extension documentation", url: "https://developer.chrome.com/docs/extensions/", lastAccessed: 20 },
  { id: 3, title: "Gmail", url: "https://mail.google.com/", lastAccessed: 30 }
];

test("normalizes configurable command-bar colors", () => {
  assert.equal(normalizeThemeColor("#abc"), "#aabbcc");
  assert.equal(normalizeThemeColor("#A1B2C3"), "#a1b2c3");
  assert.equal(normalizeThemeColor("purple"), DEFAULT_COMMAND_BAR_COLOR);
  assert.match(commandBarThemeCss("#123456", ":host"), /:host[\s\S]*#123456/);
});

test("finds duplicate tabs using the exact URL", () => {
  const openTabs = [
    { id: 1, url: "https://example.com/page?view=one#top", lastAccessed: 10 },
    { id: 2, url: "https://example.com/page?view=one#top", lastAccessed: 20 },
    { id: 3, url: "https://example.com/page?view=two#top", lastAccessed: 30 },
    { id: 4, url: "https://example.com/page?view=one#bottom", lastAccessed: 40 }
  ];

  assert.deepEqual(duplicateTabIds(openTabs), [1]);
  assert.deepEqual(duplicateTabIds(openTabs, 1), [2]);
});

test("prefers pinned then active duplicate tabs when no invoked tab matches", () => {
  const openTabs = [
    { id: 1, url: "https://one.example/", active: true, lastAccessed: 30 },
    { id: 2, url: "https://one.example/", pinned: true, lastAccessed: 10 },
    { id: 3, url: "https://two.example/", lastAccessed: 10 },
    { id: 4, url: "https://two.example/", active: true, lastAccessed: 5 }
  ];

  assert.deepEqual(duplicateTabIds(openTabs), [1, 3]);
});

test("normalizes case and accents", () => {
  assert.equal(normalize("  HÉLIUM  "), "helium");
});

test("normalizes configurable result section order", () => {
  assert.deepEqual(
    normalizeResultSectionOrder(["favorites", "open", "closed"]),
    ["favorites", "open", "closed"]
  );
  assert.deepEqual(
    normalizeResultSectionOrder(["favorites", "favorites", "unknown"]),
    ["favorites", "open", "closed"]
  );
  assert.deepEqual(
    normalizeResultSectionOrder(null),
    [...DEFAULT_RESULT_SECTION_ORDER]
  );
});

test("removes redundant GitHub branding only from GitHub tabs", () => {
  assert.equal(cleanTabTitle({
    title: "GitHub - imputnet/helium: Private Chromium browser",
    url: "https://github.com/imputnet/helium"
  }), "imputnet/helium: Private Chromium browser");
  assert.equal(cleanTabTitle({
    title: "GitHub – Dashboard",
    url: "https://github.com/"
  }), "Dashboard");
  assert.equal(cleanTabTitle({
    title: "GitHub - documentation",
    url: "https://example.com/github"
  }), "GitHub - documentation");

  const githubTab = {
    id: 9,
    title: "GitHub - imputnet/helium",
    url: "https://github.com/imputnet/helium"
  };
  assert.equal(filterTabs([githubTab], "github")[0], githubTab);
});

test("ranks title matches ahead of URL-only matches", () => {
  const results = filterTabs(tabs, "extension");
  assert.equal(results[0].id, 2);
});

test("supports dense fuzzy title matching", () => {
  assert.notEqual(scoreTab(tabs[1], "ext doc"), null);
  assert.notEqual(scoreTab(tabs[0], "gthb"), null);
  assert.equal(scoreTab(tabs[2], "ext doc"), null);
});

test("rejects sparse subsequences in unrelated titles", () => {
  assert.equal(scoreTab({
    title: "Settings – Keyboard shortcuts",
    url: "helium://settings/keyboard"
  }, "youtu"), null);
  assert.equal(scoreTab({
    title: "GitHub – tempoxyz/tempo: the blockchain for payments",
    url: "https://github.com/tempoxyz/tempo"
  }, "youtu"), null);
  assert.notEqual(scoreTab({
    title: "youtube - Google Search",
    url: "https://www.google.com/search?q=youtube"
  }, "youtu"), null);
});

test("finds Helium settings destinations by title and keywords", () => {
  const [shortcuts] = filterSettings("Keyboard shortcuts");
  assert.equal(shortcuts.title, "Keyboard shortcuts");
  assert.equal(shortcuts.url, "helium://settings/system/shortcuts");
  assert.equal(filterSettings("hotkeys")[0].id, "keyboard-shortcuts");
  assert.equal(filterSettings("settings")[0].url, "helium://settings");
  assert.equal(filterSettings("extensions")[0].url, "helium://extensions");
  assert.equal(filterSettings("plugins")[0].id, "extensions");
  assert.equal(filterSettings("manage bookmarks")[0].url, "helium://bookmarks");
  assert.equal(filterSettings("organize favorites")[0].id, "bookmarks");
  assert.deepEqual(filterSettings(""), []);
  assert.equal(getSettingById("keyboard-shortcuts"), shortcuts);
  assert.equal(getSettingById("missing"), null);
});

test("offers inverse pin and favorite actions for the current tab", () => {
  assert.equal(filterTabActions("pin", { id: 1, pinned: false })[0].title, "Pin tab");
  assert.equal(filterTabActions("unpin", { id: 1, pinned: true })[0].title, "Unpin tab");
  assert.equal(
    filterTabActions("favorite", { id: 1, bookmarkId: null })[0].title,
    "Add to Favorites"
  );
  assert.equal(
    filterTabActions("remove favorite", { id: 1, bookmarkId: "bookmark" })[0].title,
    "Remove from Favorites"
  );
  assert.equal(filterTabActions("youtube", { id: 1, pinned: false }).length, 0);
  assert.deepEqual(filterTabActions("pin", null), []);
});

test("recognizes open internal destinations with their most specific behavior", () => {
  assert.equal(getSettingForTab({ url: "helium://settings" }).id, "settings");
  assert.equal(
    getSettingForTab({ url: "helium://settings/system/shortcuts" }).id,
    "keyboard-shortcuts"
  );
  assert.equal(getSettingForTab({ url: "chrome://extensions/?id=abc" }).id, "extensions");
  assert.equal(getSettingForTab({ url: "helium://bookmarks/?id=42" }).id, "bookmarks");
  assert.equal(getSettingForTab({ url: "https://example.com/extensions" }), null);
});

test("sorts empty queries by recent access", () => {
  assert.deepEqual(filterTabs(tabs, "").map((tab) => tab.id), [3, 2, 1]);
});

test("sorts open tabs by recent access instead of active or pinned state", () => {
  const openTabs = [
    { id: 1, windowId: 1, title: "Pinned", url: "https://pinned.example/", pinned: true, active: true, lastAccessed: 10 },
    { id: 2, windowId: 1, title: "Recent", url: "https://recent.example/", lastAccessed: 30 },
    { id: 3, windowId: 1, title: "Middle", url: "https://middle.example/", lastAccessed: 20 }
  ];

  assert.deepEqual(filterTabs(openTabs, "").map((tab) => tab.id), [2, 3, 1]);
  assert.deepEqual(
    filterTabBlocks(openTabs, "").map((block) => block.representative.id),
    [2, 3, 1]
  );
});

test("flattens and filters bookmarks that are not already open", () => {
  const bookmarks = flattenBookmarks([{
    id: "root",
    title: "Bookmarks bar",
    children: [
      { id: "b1", title: "Helium", url: "https://helium.computer/", dateAdded: 10 },
      {
        id: "folder",
        title: "Development",
        children: [{ id: "b2", title: "Chrome APIs", url: "https://developer.chrome.com/docs/extensions", dateLastUsed: 20 }]
      }
    ]
  }]);

  assert.equal(bookmarks[1].folder, "Bookmarks bar / Development");
  assert.equal(bookmarkUrlKey("https://helium.computer/#download"), "https://helium.computer/");
  assert.deepEqual(
    filterBookmarks(bookmarks, "", [{ url: "https://helium.computer/#about" }]).map((item) => item.id),
    ["b2"]
  );
  assert.equal(filterBookmarks(bookmarks, "chrome", []).length, 1);
  assert.deepEqual(filterBookmarks(bookmarks, "", [], ["folder"]).map((item) => item.id), ["b2"]);
  assert.deepEqual(filterBookmarks(bookmarks, "", [], []).map((item) => item.id), []);

  const [favoriteTab] = attachBookmarkMetadata([{
    id: 9,
    title: "GitHub - tempoxyz/zones: Zones are private blockchains",
    url: "https://github.com/tempoxyz/zones"
  }], [{
    id: "favorite",
    title: "zones",
    url: "https://github.com/tempoxyz/zones"
  }]);
  assert.equal(displayTabTitle(favoriteTab), "zones");
  assert.equal(filterTabs([favoriteTab], "zones")[0], favoriteTab);
  assert.equal(filterTabs([favoriteTab], "github")[0], favoriteTab);
});

test("ranks an exact URL path component above a partial owner match", () => {
  const favorites = [
    {
      id: "zones",
      title: "zones",
      url: "https://github.com/tempoxyz/zones",
      lastAccessed: 20
    },
    {
      id: "tempo",
      title: "payments repository",
      url: "https://github.com/tempoxyz/tempo",
      lastAccessed: 10
    }
  ];

  assert.deepEqual(
    filterBookmarks(favorites, "tempo", []).map((bookmark) => bookmark.id),
    ["tempo", "zones"]
  );
});

test("groups members of a split view into one tab block", () => {
  const splitTabs = [
    { id: 1, windowId: 7, index: 0, title: "Before", splitViewId: -1 },
    { id: 2, windowId: 7, index: 1, title: "Docs", splitViewId: 42, lastAccessed: 20 },
    { id: 3, windowId: 7, index: 2, title: "Preview", splitViewId: 42, active: true, lastAccessed: 10 },
    { id: 4, windowId: 7, index: 3, title: "After", splitViewId: -1 }
  ];

  assert.equal(isSplitTab(splitTabs[0]), false);
  assert.equal(isSplitTab(splitTabs[1]), true);
  const blocks = buildTabBlocks(splitTabs);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].type, "split");
  assert.deepEqual(blocks[1].members.map((tab) => tab.id), [2, 3]);
  assert.equal(blocks[1].representative.id, 3);
});

test("treats a lone visible split member as a normal tab", () => {
  const [block] = buildTabBlocks([
    { id: 2, windowId: 7, index: 1, splitViewId: 42, active: false }
  ]);
  assert.equal(block.type, "single");
  assert.equal(block.splitViewId, null);
});

test("matches a split block through either pane", () => {
  const splitTabs = [
    { id: 2, windowId: 7, index: 1, title: "API documentation", url: "https://docs.example", splitViewId: 42 },
    { id: 3, windowId: 7, index: 2, title: "Local preview", url: "http://localhost:3000", splitViewId: 42 }
  ];

  assert.equal(filterTabBlocks(splitTabs, "documentation")[0].type, "split");
  assert.equal(filterTabBlocks(splitTabs, "localhost")[0].members.length, 2);
  assert.equal(filterTabBlocks(splitTabs, "missing").length, 0);
});

test("does not combine equal split IDs from different windows", () => {
  const splitTabs = [
    { id: 1, windowId: 7, index: 0, splitViewId: 42 },
    { id: 2, windowId: 8, index: 0, splitViewId: 42 }
  ];
  assert.equal(buildTabBlocks(splitTabs).length, 2);
});

test("filters built-in settings and placeholder tabs from recently closed", () => {
  const ignored = [
    { title: "Settings – Keyboard shortcuts", url: "helium://settings/system/shortcuts" },
    { title: "Keyboard shortcuts", url: "helium://settings/system/shortcuts" },
    { title: "Settings", url: "helium://settings" },
    { title: "Extensions", url: "chrome://extensions/" },
    { title: "Bookmarks", url: "helium://bookmarks/" },
    { title: "New Tab", url: "chrome://newtab/" },
    { title: "New split tab", url: "chrome://tab-search.top-chrome/split_new_tab_page.html" },
    { title: "New split tab", url: "chrome-extension://extension-id/split-picker.html" }
  ];
  for (const tab of ignored) assert.equal(isIgnoredRecentlyClosedTab(tab), true);

  assert.equal(isIgnoredRecentlyClosedTab({
    title: "Application settings guide",
    url: "https://example.com/settings-guide"
  }), false);
  assert.equal(sessionToItem({
    lastModified: 10,
    tab: { sessionId: "settings", ...ignored[0] }
  }), null);
});

test("keeps useful tabs from a closed window while filtering placeholders", () => {
  const item = sessionToItem({
    lastModified: 20,
    window: {
      sessionId: "window-1",
      tabs: [
        { title: "New Tab", url: "chrome://newtab/", active: true },
        { title: "Useful documentation", url: "https://docs.example" }
      ]
    }
  });
  assert.equal(item.title, "Useful documentation");
  assert.equal(item.tabCount, 1);
});

test("converts closed tabs and windows into searchable items", () => {
  const closedTab = sessionToItem({
    lastModified: 10,
    tab: {
      sessionId: "tab-1",
      title: "Helium release notes",
      url: "https://helium.computer/releases"
    }
  });
  assert.equal(closedTab.title, "Helium release notes");
  assert.equal(closedTab.isWindow, false);

  const closedWindow = sessionToItem({
    lastModified: 20,
    window: {
      sessionId: "window-1",
      tabs: [
        { title: "First", url: "https://first.example" },
        { title: "Hidden match", url: "https://second.example", active: true }
      ]
    }
  });
  assert.equal(closedWindow.title, "Hidden match + 1 more");
  assert.equal(closedWindow.tabCount, 2);
});

test("searches every tab in a recently closed window", () => {
  const sessions = [{
    lastModified: 20,
    window: {
      sessionId: "window-1",
      tabs: [
        { title: "Visible tab", url: "https://visible.example", active: true },
        { title: "Important documentation", url: "https://docs.example" }
      ]
    }
  }];

  assert.equal(filterRecentlyClosed(sessions, "important docs")[0].sessionId, "window-1");
  assert.equal(filterRecentlyClosed(sessions, "missing").length, 0);
});

test("sorts recently closed sessions by recency", () => {
  const sessions = [
    { lastModified: 10, tab: { sessionId: "old", title: "Old", url: "https://old.example" } },
    { lastModified: 20, tab: { sessionId: "new", title: "New", url: "https://new.example" } }
  ];
  assert.deepEqual(filterRecentlyClosed(sessions, "").map((item) => item.sessionId), ["new", "old"]);
});

test("resolves common URL inputs", () => {
  assert.deepEqual(resolveInput("example.com/path"), {
    kind: "url",
    url: "https://example.com/path",
    display: "example.com/path"
  });
  assert.equal(resolveInput("http://localhost:3000").kind, "url");
  assert.equal(resolveInput("192.168.1.2:8080/admin").kind, "url");
});

test("treats ordinary text and unsafe protocols as searches", () => {
  assert.deepEqual(resolveInput("helium browser"), {
    kind: "search",
    text: "helium browser"
  });
  assert.equal(resolveInput("javascript:alert(1)").kind, "search");
});
