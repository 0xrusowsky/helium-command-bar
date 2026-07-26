import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTabBlocks,
  filterRecentlyClosed,
  filterSettings,
  filterTabBlocks,
  filterTabs,
  getSettingById,
  getSettingForTab,
  isIgnoredRecentlyClosedTab,
  isSplitTab,
  normalize,
  resolveInput,
  scoreTab,
  sessionToItem
} from "../search.js";

const tabs = [
  { id: 1, title: "GitHub · Dashboard", url: "https://github.com/", lastAccessed: 10 },
  { id: 2, title: "Extension documentation", url: "https://developer.chrome.com/docs/extensions/", lastAccessed: 20 },
  { id: 3, title: "Gmail", url: "https://mail.google.com/", lastAccessed: 30 }
];

test("normalizes case and accents", () => {
  assert.equal(normalize("  HÉLIUM  "), "helium");
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
  assert.deepEqual(filterSettings(""), []);
  assert.equal(getSettingById("keyboard-shortcuts"), shortcuts);
  assert.equal(getSettingById("missing"), null);
});

test("recognizes open internal destinations with their most specific behavior", () => {
  assert.equal(getSettingForTab({ url: "helium://settings" }).id, "settings");
  assert.equal(
    getSettingForTab({ url: "helium://settings/system/shortcuts" }).id,
    "keyboard-shortcuts"
  );
  assert.equal(getSettingForTab({ url: "chrome://extensions/?id=abc" }).id, "extensions");
  assert.equal(getSettingForTab({ url: "https://example.com/extensions" }), null);
});

test("sorts empty queries by recent access", () => {
  assert.deepEqual(filterTabs(tabs, "").map((tab) => tab.id), [3, 2, 1]);
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
