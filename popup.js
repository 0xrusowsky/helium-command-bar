import {
  DEFAULT_RESULT_SECTION_ORDER,
  attachBookmarkMetadata,
  bookmarkUrlKey,
  bookmarksInFolders,
  displayTabTitle,
  filterBookmarks,
  filterRecentlyClosed,
  filterSettings,
  filterTabActions,
  filterTabBlocks,
  flattenBookmarks,
  getSettingById,
  getSettingForTab,
  hostnameFor,
  normalizeResultSectionOrder,
  resolveInput
} from "./search.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  applyCommandBarTheme
} from "./theme.js";
import { getExtensionUpdateState } from "./update.js";

const queryInput = document.querySelector("#query");
const resultsElement = document.querySelector("#results");
const resultLabel = document.querySelector("#result-label");
const emptyElement = document.querySelector("#empty");

function closeCommandBar() {
  window.close();
}

let allTabs = [];
let invokingTabId = null;
let allBookmarks = [];
let recentlyClosedSessions = [];
let updateState = null;
let rows = [];
let navigationItems = [];
let selectedIndex = 0;
let defaultSplitExpanded = false;
let showFavorites = true;
let showRecentlyClosed = true;
let favoriteFolderIds = null;
let resultSectionOrder = [...DEFAULT_RESULT_SECTION_ORDER];
const splitNavigationKeys = new Set();
const expandedSettingIds = new Set();

function isSplitVisuallyExpanded(splitKey) {
  return defaultSplitExpanded || splitNavigationKeys.has(splitKey);
}

function createSvgIcon(pathData, className = "row-icon") {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add(className);

  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function launchRow(input) {
  const target = resolveInput(input);
  if (!target) return null;
  return { kind: "launch", target };
}

function bookmarkWithFavicon(bookmark) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", bookmark.url);
  url.searchParams.set("size", "32");
  return { ...bookmark, favIconUrl: url.href };
}

function updateRows({ resetSelection = false } = {}) {
  const input = queryInput.value;
  const configuredBookmarks = bookmarksInFolders(allBookmarks, favoriteFolderIds);
  const enabledBookmarks = showFavorites ? configuredBookmarks : [];
  const regularTabs = attachBookmarkMetadata(
    allTabs.filter((tab) => tab.id !== invokingTabId && !getSettingForTab(tab)),
    enabledBookmarks
  );
  const matchedBlocks = filterTabBlocks(regularTabs, input, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1);
  const matchedClosed = showRecentlyClosed
    ? filterRecentlyClosed(recentlyClosedSessions, input)
    : [];
  const matchedBookmarks = showFavorites
    ? filterBookmarks(allBookmarks, input, allTabs, favoriteFolderIds)
    : [];
  const matchedSettings = filterSettings(input);
  const currentRawTab = allTabs.find((tab) => tab.id === invokingTabId) || null;
  const currentTab = currentRawTab
    ? attachBookmarkMetadata([currentRawTab], configuredBookmarks)[0]
    : null;
  const matchedTabActions = filterTabActions(input, currentTab);
  const launch = launchRow(input);
  const openSettingTabs = new Map();
  for (const tab of [...allTabs].sort((left, right) =>
    Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
    (right.lastAccessed || 0) - (left.lastAccessed || 0)
  )) {
    const setting = getSettingForTab(tab);
    if (setting && !openSettingTabs.has(setting.id)) openSettingTabs.set(setting.id, tab);
  }
  const openRows = matchedBlocks.flatMap((block) => block.type === "split"
    ? block.members.map((tab) => ({
        kind: "split-member",
        tab,
        splitKey: block.key,
        splitViewId: block.splitViewId,
        splitSize: block.members.length
      }))
    : [{ kind: "tab", tab: block.members[0] }]);
  const searchRows = [
    ...(updateState?.updateAvailable ? [{
      kind: "update",
      setting: {
        title: "Update extension",
        description: `Reload version ${updateState.availableVersion}`,
        icon: "settings"
      }
    }] : []),
    ...(launch ? [launch] : []),
    ...matchedSettings.flatMap((setting) => {
      const parent = {
        kind: "setting",
        setting,
        expandable: setting.id === "extensions",
        tab: openSettingTabs.get(setting.id) || null
      };
      if (setting.id !== "extensions") return [parent];
      const extensionSettings = getSettingById("extension-settings");
      return [parent, {
        kind: "extension-setting",
        parentSettingId: "extensions",
        setting: extensionSettings,
        tab: openSettingTabs.get(extensionSettings.id) || null
      }, {
        kind: "extension-update",
        parentSettingId: "extensions",
        setting: {
          title: "Update extension",
          description: "Reload the Helium Command Bar extension",
          icon: "settings"
        }
      }];
    }),
    ...matchedTabActions.map((action) => ({
      kind: "tab-action",
      action,
      tabId: currentTab.id
    }))
  ];
  const sectionRows = {
    open: openRows,
    favorites: matchedBookmarks.map((bookmark) => ({
      kind: "bookmark",
      bookmark: bookmarkWithFavicon(bookmark)
    })),
    closed: matchedClosed.map((closed) => ({ kind: "closed", closed }))
  };
  rows = [
    ...searchRows,
    ...resultSectionOrder.flatMap((key) => sectionRows[key])
  ];

  if (resetSelection) selectedIndex = 0;

  const totalMatches = matchedSettings.length + matchedTabActions.length + openRows.length + matchedBookmarks.length + matchedClosed.length;
  if (!input.trim()) {
    resultLabel.textContent = `${openRows.length} open · ${matchedBookmarks.length} bookmarks · ${matchedClosed.length} recently closed`;
  } else if (totalMatches === 0) {
    resultLabel.textContent = "No matching tabs";
  } else {
    resultLabel.textContent = `${openRows.length} open · ${matchedBookmarks.length} bookmarks · ${matchedClosed.length} recently closed`;
  }

  emptyElement.hidden = rows.length !== 0;
  renderRows();
}

function setSelected(index, { scroll = true } = {}) {
  if (!navigationItems.length) return;
  selectedIndex = (index + navigationItems.length) % navigationItems.length;

  navigationItems.forEach((item, itemIndex) => {
    const selected = itemIndex === selectedIndex;
    item.element.classList.toggle("selected", selected);
    item.element.setAttribute("aria-selected", String(selected));
  });

  const selectedElement = navigationItems[selectedIndex]?.element;
  queryInput.setAttribute("aria-activedescendant", selectedElement?.id || "");
  if (scroll) selectedElement?.scrollIntoView({ block: "nearest" });
}

function isArrowKey(event, direction, keyCode) {
  return event.key === `Arrow${direction}` ||
    event.key === direction ||
    event.code === `Arrow${direction}` ||
    event.keyCode === keyCode;
}

function isKey(event, key, keyCode) {
  return event.key === key || event.code === key || event.keyCode === keyCode;
}

function makeTabRow(row, index) {
  const { tab } = row;
  const displayTitle = displayTabTitle(tab) || "Untitled tab";
  const element = document.createElement("li");
  element.className = `result-row tab-row${row.kind === "split-member" ? " split-member-row" : ""}`;
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "favicon-box";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = (displayTitle || hostnameFor(tab) || "T").trim().charAt(0).toLocaleUpperCase();
  iconBox.append(fallback);

  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = tab.favIconUrl;
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.addEventListener("load", () => fallback.remove());
    favicon.addEventListener("error", () => favicon.remove());
    iconBox.append(favicon);
  }

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = displayTitle;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  subtitle.textContent = hostnameFor(tab);
  details.append(title, subtitle);

  const trailing = document.createElement("span");
  trailing.className = "row-trailing";
  if (tab.active) {
    const current = document.createElement("span");
    current.className = "current-pill";
    current.textContent = "Active";
    trailing.append(current);
  }
  if (tab.bookmarkId) {
    const favorite = document.createElement("span");
    favorite.className = "favorite-tab-indicator";
    favorite.title = "Favorite";
    favorite.setAttribute("aria-label", "Favorite");
    favorite.append(createSvgIcon(
      "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z",
      "favorite-tab-icon"
    ));
    trailing.append(favorite);
  }
  if (tab.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "pinned-tab-indicator";
    pinned.title = "Pinned tab";
    pinned.setAttribute("aria-label", "Pinned tab");
    pinned.append(createSvgIcon(
      "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h7v7h2v-7h7v-2c-1.66 0-3-1.34-3-3Z",
      "pinned-tab-icon"
    ));
    trailing.append(pinned);
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-tab";
  closeButton.setAttribute("aria-label", `Close ${displayTitle}`);
  closeButton.title = "Close tab";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await closeTab(tab.id);
  });
  trailing.append(closeButton);
  const enterHint = document.createElement("kbd");
  enterHint.className = "tab-enter-hint";
  enterHint.textContent = "↵";
  trailing.append(enterHint);

  element.append(iconBox, details, trailing);
  return element;
}

function splitRepresentative(memberRows) {
  return memberRows.find((row) => row.tab.active)?.tab ||
    [...memberRows].sort((left, right) => (right.tab.lastAccessed || 0) - (left.tab.lastAccessed || 0))[0]?.tab;
}

function makeSplitGroup(size, navigationEntered, label = "Split view") {
  const group = document.createElement("li");
  group.className = `split-group expanded${navigationEntered ? " navigation-entered" : ""}`;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${label} with ${size} options`);

  const header = document.createElement("div");
  header.className = "split-group-header";
  header.append(
    createSvgIcon("M4 5.5h7v13H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm9 0h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v-13Z", "split-group-icon"),
    document.createTextNode(label),
    Object.assign(document.createElement("kbd"), {
      className: "split-navigation-hint",
      textContent: navigationEntered ? "←" : "→"
    })
  );

  const entries = document.createElement("ul");
  entries.className = "split-group-entries";
  entries.setAttribute("role", "presentation");
  group.append(header, entries);
  return { group, entries };
}

function makeCompactFavicon(tab) {
  const iconBox = document.createElement("span");
  iconBox.className = "compact-favicon-box";
  const fallback = document.createElement("span");
  fallback.textContent = (displayTabTitle(tab) || hostnameFor(tab) || "T").trim().charAt(0).toLocaleUpperCase();
  iconBox.append(fallback);

  if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
    const favicon = document.createElement("img");
    favicon.src = tab.favIconUrl;
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.addEventListener("load", () => fallback.remove());
    favicon.addEventListener("error", () => favicon.remove());
    iconBox.append(favicon);
  }
  return iconBox;
}

function makeCollapsedSplit(memberRows, index) {
  const group = document.createElement("li");
  group.className = "split-group collapsed";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `Split view with ${memberRows.length} tabs`);

  const option = document.createElement("div");
  option.className = "result-row split-collapsed-row";
  option.id = `result-${index}`;
  option.setAttribute("role", "option");

  const columns = document.createElement("span");
  columns.className = "split-columns";
  memberRows.forEach((memberRow) => {
    const { tab } = memberRow;
    const displayTitle = displayTabTitle(tab) || "Untitled tab";
    const column = document.createElement("button");
    column.type = "button";
    column.className = "split-column";
    column.title = `Open split and focus ${displayTitle}`;
    const details = document.createElement("span");
    details.className = "split-column-details";
    const title = document.createElement("span");
    title.className = "split-column-title";
    title.textContent = displayTitle;
    const subtitle = document.createElement("span");
    subtitle.className = "split-column-subtitle";
    subtitle.textContent = hostnameFor(tab);
    details.append(title, subtitle);
    column.append(makeCompactFavicon(tab), details);
    if (tab.bookmarkId) {
      const favorite = document.createElement("span");
      favorite.className = "favorite-tab-indicator";
      favorite.title = "Favorite";
      favorite.append(createSvgIcon(
        "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z",
        "favorite-tab-icon"
      ));
      column.append(favorite);
    }
    if (tab.pinned) {
      const pinned = document.createElement("span");
      pinned.className = "pinned-tab-indicator";
      pinned.title = "Pinned tab";
      pinned.append(createSvgIcon(
        "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h7v7h2v-7h7v-2c-1.66 0-3-1.34-3-3Z",
        "pinned-tab-icon"
      ));
      column.append(pinned);
    }
    column.addEventListener("click", async (event) => {
      event.stopPropagation();
      await activateTab(tab);
    });
    columns.append(column);
  });

  const hint = document.createElement("kbd");
  hint.className = "split-navigation-hint";
  hint.textContent = "→";
  hint.title = "Enter split navigation";
  option.append(columns, hint);
  group.append(option);
  return { group, option };
}

function makeBookmarkRow(row, index) {
  const { bookmark } = row;
  const element = document.createElement("li");
  element.className = "result-row bookmark-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "favicon-box favorite-favicon-box";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = (bookmark.title || hostnameFor(bookmark) || "B").trim().charAt(0).toLocaleUpperCase();
  iconBox.append(fallback);

  if (bookmark.favIconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = bookmark.favIconUrl;
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.addEventListener("load", () => fallback.remove());
    favicon.addEventListener("error", () => favicon.remove());
    iconBox.append(favicon);
  }

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = bookmark.title || "Untitled bookmark";
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  const location = hostnameFor(bookmark);
  subtitle.textContent = bookmark.folder
    ? `${location} · ${bookmark.folder}`
    : location;
  details.append(title, subtitle);

  const enterHint = document.createElement("kbd");
  enterHint.className = "enter-hint";
  enterHint.textContent = "↵";
  element.append(iconBox, details, enterHint);
  return element;
}

function makeClosedRow(row, index) {
  const { closed } = row;
  const element = document.createElement("li");
  element.className = "result-row recently-closed-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "favicon-box closed-favicon-box";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = (closed.title || hostnameFor(closed) || "T").trim().charAt(0).toLocaleUpperCase();
  iconBox.append(fallback);

  if (closed.favIconUrl && !closed.favIconUrl.startsWith("chrome://")) {
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    favicon.src = closed.favIconUrl;
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    favicon.addEventListener("load", () => fallback.remove());
    favicon.addEventListener("error", () => favicon.remove());
    iconBox.append(favicon);
  }

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = closed.title;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  const location = hostnameFor(closed);
  const closedType = closed.isWindow ? `${closed.tabCount} tabs · Recently closed window` : "Recently closed";
  subtitle.textContent = location ? `${location} · ${closedType}` : closedType;
  details.append(title, subtitle);

  const restore = document.createElement("span");
  restore.className = "restore-pill";
  restore.append(
    createSvgIcon("M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5", "restore-icon"),
    document.createTextNode("Restore")
  );

  element.append(iconBox, details, restore);
  return element;
}

function makeTabActionRow(row, index) {
  const { action } = row;
  const element = document.createElement("li");
  element.className = "result-row tab-action-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = `tab-action-icon-box ${action.icon}`;
  iconBox.append(createSvgIcon(
    action.icon === "favorite"
      ? "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z"
      : "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h7v7h2v-7h7v-2c-1.66 0-3-1.34-3-3Z",
    action.icon === "favorite" ? "favorite-action-icon" : "pin-action-icon"
  ));

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = action.title;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  subtitle.textContent = action.description;
  details.append(title, subtitle);

  const enterHint = document.createElement("kbd");
  enterHint.className = "enter-hint";
  enterHint.textContent = "↵";
  element.append(iconBox, details, enterHint);
  return element;
}

function settingIconPath(setting) {
  if (setting.icon === "keyboard") {
    return "M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm3 4h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10";
  }
  if (setting.icon === "extensions") {
    return "M8.5 3H5a2 2 0 0 0-2 2v3.5h1.5a2.5 2.5 0 1 1 0 5H3V17a2 2 0 0 0 2 2h3.5v-1.5a2.5 2.5 0 1 1 5 0V19H17a2 2 0 0 0 2-2v-3.5h1.5a2.5 2.5 0 1 0 0-5H19V5a2 2 0 0 0-2-2h-3.5v1.5a2.5 2.5 0 1 1-5 0V3Z";
  }
  if (setting.icon === "bookmarks") {
    return "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z";
  }
  return "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.73v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Zm-.22 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z";
}

function makeSettingRow(row, index) {
  const { setting } = row;
  const element = document.createElement("li");
  element.className = "result-row setting-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = `setting-icon-box ${setting.icon || "settings"}`;
  iconBox.append(createSvgIcon(settingIconPath(setting), "setting-icon"));

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = setting.title;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  subtitle.textContent = row.tab
    ? `${setting.description} · Open tab`
    : `${setting.description} · Helium`;
  details.append(title, subtitle);

  const enterHint = document.createElement("kbd");
  enterHint.className = "enter-hint";
  enterHint.textContent = row.expandable ? "→" : "↵";
  element.append(iconBox, details, enterHint);
  return element;
}

function makeLaunchRow(row, index) {
  const element = document.createElement("li");
  element.className = "result-row launch-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "launch-icon-box";
  const isUrl = row.target.kind === "url";
  iconBox.append(createSvgIcon(
    isUrl
      ? "M14 5h5v5m0-5L10 14m7 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"
      : "m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
  ));

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = isUrl ? `Open ${row.target.display}` : `Search for “${row.target.text}”`;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  subtitle.textContent = isUrl ? "New tab" : "Default search engine · New tab";
  details.append(title, subtitle);

  const enterHint = document.createElement("kbd");
  enterHint.className = "enter-hint";
  const isMac = navigator.userAgentData?.platform === "macOS" || /Mac/.test(navigator.platform);
  enterHint.textContent = isMac ? "⌘↵" : "Ctrl↵";
  enterHint.title = "Always open or search the input in a new tab";
  element.append(iconBox, details, enterHint);
  return element;
}

function bindNavigationItem(element, item) {
  const index = navigationItems.length;
  const navigationItem = { ...item, element };
  navigationItems.push(navigationItem);
  element.id = `result-${index}`;
  element.dataset.navigationIndex = String(index);
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", () => activateNavigationItem(index));
  element.addEventListener("mouseenter", () => setSelected(index, { scroll: false }));
  return element;
}

function makeResultSection(title) {
  const section = document.createElement("section");
  section.className = "result-section";
  const heading = document.createElement("div");
  heading.className = "result-section-heading";
  heading.textContent = title;
  const list = document.createElement("ul");
  list.className = "result-section-list";
  list.setAttribute("role", "presentation");
  section.append(heading, list);
  return { section, list };
}

function renderRows() {
  const fragment = document.createDocumentFragment();
  const sections = {
    search: makeResultSection("Search"),
    open: makeResultSection("Open"),
    favorites: makeResultSection("Bookmarks"),
    closed: makeResultSection("Recently closed")
  };
  navigationItems = [];
  let rowIndex = 0;

  while (rowIndex < rows.length) {
    const row = rows[rowIndex];
    if (
      (row.kind === "extension-setting" || row.kind === "extension-update") &&
      !expandedSettingIds.has(row.parentSettingId)
    ) {
      rowIndex += 1;
      continue;
    }
    if (row.kind === "setting" && row.expandable && expandedSettingIds.has(row.setting.id)) {
      const childRows = [];
      rowIndex += 1;
      while (rowIndex < rows.length && rows[rowIndex].parentSettingId === row.setting.id) {
        childRows.push(rows[rowIndex]);
        rowIndex += 1;
      }
      const { group, entries } = makeSplitGroup(childRows.length, true, row.setting.title);
      for (const childRow of childRows) {
        const rowElement = makeSettingRow(childRow, navigationItems.length);
        rowElement.classList.add("split-member-row");
        entries.append(bindNavigationItem(rowElement, { kind: "row", row: childRow }));
      }
      sections.search.list.append(group);
      continue;
    }
    if (row.kind === "split-member") {
      const splitKey = row.splitKey;
      const memberRows = [];
      while (rowIndex < rows.length && rows[rowIndex].kind === "split-member" && rows[rowIndex].splitKey === splitKey) {
        memberRows.push(rows[rowIndex]);
        rowIndex += 1;
      }

      const navigationEntered = splitNavigationKeys.has(splitKey);
      if (isSplitVisuallyExpanded(splitKey)) {
        const { group, entries } = makeSplitGroup(memberRows.length, navigationEntered);
        if (navigationEntered) {
          memberRows.forEach((memberRow) => {
            const element = makeTabRow(memberRow, navigationItems.length);
            entries.append(bindNavigationItem(element, { kind: "split-member", row: memberRow, splitKey, memberRows }));
          });
        } else {
          memberRows.forEach((memberRow) => {
            const element = makeTabRow(memberRow, navigationItems.length);
            element.removeAttribute("id");
            element.setAttribute("role", "presentation");
            element.addEventListener("mousedown", (event) => event.preventDefault());
            element.addEventListener("click", async (event) => {
              event.stopPropagation();
              await activateTab(memberRow.tab);
            });
            entries.append(element);
          });
          group.setAttribute("role", "option");
          bindNavigationItem(group, { kind: "split-group", splitKey, memberRows });
        }
        sections.open.list.append(group);
      } else {
        const { group, option } = makeCollapsedSplit(memberRows, navigationItems.length);
        bindNavigationItem(option, { kind: "split-group", splitKey, memberRows });
        sections.open.list.append(group);
      }
      continue;
    }

    let element;
    if (row.kind === "tab") element = makeTabRow(row, navigationItems.length);
    else if (row.kind === "bookmark") element = makeBookmarkRow(row, navigationItems.length);
    else if (row.kind === "closed") element = makeClosedRow(row, navigationItems.length);
    else if (row.kind === "setting" || row.kind === "extension-setting" || row.kind === "extension-update" || row.kind === "update") element = makeSettingRow(row, navigationItems.length);
    else if (row.kind === "tab-action") element = makeTabActionRow(row, navigationItems.length);
    else element = makeLaunchRow(row, navigationItems.length);
    const section = row.kind === "launch" || row.kind === "setting" || row.kind === "extension-setting" || row.kind === "extension-update" || row.kind === "update" || row.kind === "tab-action"
      ? sections.search
      : row.kind === "bookmark"
        ? sections.favorites
        : row.kind === "closed" ? sections.closed : sections.open;
    section.list.append(bindNavigationItem(element, { kind: "row", row }));
    rowIndex += 1;
  }

  for (const key of ["search", ...resultSectionOrder]) {
    const section = sections[key];
    if (section?.list.childElementCount > 0) fragment.append(section.section);
  }
  resultsElement.replaceChildren(fragment);
  selectedIndex = Math.max(0, Math.min(selectedIndex, navigationItems.length - 1));
  setSelected(selectedIndex, { scroll: false });
  queryInput.focus({ preventScroll: true });
}

async function activateTab(tab) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "helium-command-bar:activate-tab",
      tabId: tab.id,
      windowId: tab.windowId
    });
    if (!response?.ok) throw new Error("The browser did not activate the tab");
    closeCommandBar();
  } catch (error) {
    console.error("Could not activate tab", error);
    await loadTabs();
  }
}

async function restoreSession(closed) {
  try {
    await chrome.sessions.restore(closed.sessionId);
    closeCommandBar();
  } catch (error) {
    console.error("Could not restore recently closed session", error);
    await loadRecentlyClosed();
  }
}

async function openInput(target = resolveInput(queryInput.value)) {
  if (!target) return;

  try {
    if (target.kind === "url") {
      await chrome.tabs.create({ url: target.url, active: true });
    } else if (chrome.search?.query) {
      chrome.search.query({ text: target.text, disposition: "NEW_TAB" });
    } else {
      await chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(target.text)}`,
        active: true
      });
    }
    closeCommandBar();
  } catch (error) {
    console.error("Could not open input", error);
  }
}

async function runTabAction(row) {
  try {
    const message = row.action.id === "toggle-favorite"
      ? {
          type: "helium-command-bar:set-favorite",
          tabId: row.tabId,
          favorite: row.action.nextFavorite,
          bookmarkId: row.action.bookmarkId
        }
      : {
          type: "helium-command-bar:set-pinned",
          tabId: row.tabId,
          pinned: row.action.nextPinned
        };
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error("The browser did not update the tab");
    closeCommandBar();
  } catch (error) {
    console.error("Could not run tab action", error);
  }
}

async function openBookmark(bookmark) {
  try {
    const bookmarkKey = bookmarkUrlKey(bookmark.url);
    const existingTab = (await chrome.tabs.query({})).find((tab) =>
      bookmarkUrlKey(tab.url || tab.pendingUrl || "") === bookmarkKey
    );
    if (existingTab) await activateTab(existingTab);
    else {
      await chrome.tabs.create({ url: bookmark.url, active: true });
      closeCommandBar();
    }
  } catch (error) {
    console.error("Could not open bookmark", error);
  }
}

async function openSetting(setting, tab = null) {
  try {
    if (tab) await activateTab(tab);
    else {
      if (setting.extensionOptions) {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(setting.url),
          active: true
        });
      } else await chrome.tabs.create({ url: setting.url, active: true });
      closeCommandBar();
    }
  } catch (error) {
    console.error("Could not open browser destination", error);
  }
}

async function activateNavigationItem(index = selectedIndex) {
  const item = navigationItems[index];
  if (!item) return;

  if (item.kind === "split-group") {
    await activateTab(splitRepresentative(item.memberRows));
  } else if (item.kind === "split-member") {
    await activateTab(item.row.tab);
  } else if (item.row.kind === "tab") {
    await activateTab(item.row.tab);
  } else if (item.row.kind === "bookmark") {
    await openBookmark(item.row.bookmark);
  } else if (item.row.kind === "closed") {
    await restoreSession(item.row.closed);
  } else if (item.row.kind === "setting" || item.row.kind === "extension-setting") {
    await openSetting(item.row.setting, item.row.tab);
  } else if (item.row.kind === "update" || item.row.kind === "extension-update") {
    closeCommandBar();
    chrome.runtime.reload();
  } else if (item.row.kind === "tab-action") {
    await runTabAction(item.row);
  } else {
    await openInput(item.row.target);
  }
}

function enterSplitNavigation(item) {
  splitNavigationKeys.add(item.splitKey);
  renderRows();
  const firstMemberIndex = navigationItems.findIndex(
    (candidate) => candidate.kind === "split-member" && candidate.splitKey === item.splitKey
  );
  if (firstMemberIndex !== -1) setSelected(firstMemberIndex);
}

function exitSplitNavigation(item) {
  splitNavigationKeys.delete(item.splitKey);
  renderRows();
  const groupIndex = navigationItems.findIndex(
    (candidate) => candidate.kind === "split-group" && candidate.splitKey === item.splitKey
  );
  if (groupIndex !== -1) setSelected(groupIndex);
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    allTabs = allTabs.filter((tab) => tab.id !== tabId);
    updateRows();
    queryInput.focus();
  } catch (error) {
    console.error("Could not close tab", error);
    await loadTabs();
  }
}

async function loadTabs() {
  try {
    const [tabs, activeTabs] = await Promise.all([
      chrome.tabs.query({}),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    allTabs = tabs;
    invokingTabId = activeTabs[0]?.id ?? null;
    updateRows();
  } catch (error) {
    resultLabel.textContent = "Unable to read tabs";
    emptyElement.textContent = "Reload the extension and try again";
    emptyElement.hidden = false;
    console.error("Could not query tabs", error);
  }
}

async function loadBookmarks() {
  try {
    if (!chrome.bookmarks) {
      allBookmarks = [];
      updateRows();
      return;
    }
    allBookmarks = flattenBookmarks(await chrome.bookmarks.getTree());
    updateRows();
  } catch (error) {
    allBookmarks = [];
    console.error("Could not query bookmarks", error);
  }
}

async function loadRecentlyClosed() {
  try {
    recentlyClosedSessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    updateRows();
  } catch (error) {
    recentlyClosedSessions = [];
    console.error("Could not query recently closed tabs", error);
  }
}

queryInput.addEventListener("input", () => {
  splitNavigationKeys.clear();
  expandedSettingIds.clear();
  updateRows({ resetSelection: true });
});
queryInput.addEventListener("keydown", async (event) => {
  if (event.isComposing) return;

  if (isArrowKey(event, "Down", 40) || (event.ctrlKey && event.key === "n")) {
    event.preventDefault();
    setSelected(selectedIndex + 1);
  } else if (isArrowKey(event, "Up", 38) || (event.ctrlKey && event.key === "p")) {
    event.preventDefault();
    setSelected(selectedIndex - 1);
  } else if (isArrowKey(event, "Right", 39)) {
    const item = navigationItems[selectedIndex];
    if (item?.kind === "split-group") {
      event.preventDefault();
      enterSplitNavigation(item);
    } else if (item?.kind === "row" && item.row.expandable) {
      event.preventDefault();
      expandedSettingIds.add(item.row.setting.id);
      renderRows();
      const childIndex = navigationItems.findIndex((candidate) =>
        candidate.kind === "row" && candidate.row.parentSettingId === item.row.setting.id
      );
      if (childIndex !== -1) setSelected(childIndex);
      queryInput.focus({ preventScroll: true });
    }
  } else if (isArrowKey(event, "Left", 37)) {
    const item = navigationItems[selectedIndex];
    if (item?.kind === "split-member") {
      event.preventDefault();
      exitSplitNavigation(item);
    } else if (item?.kind === "row" && (item.row.kind === "extension-setting" || item.row.kind === "extension-update")) {
      event.preventDefault();
      expandedSettingIds.delete(item.row.parentSettingId);
      renderRows();
      const parentIndex = navigationItems.findIndex((candidate) =>
        candidate.kind === "row" && candidate.row.setting?.id === item.row.parentSettingId
      );
      if (parentIndex !== -1) setSelected(parentIndex);
      queryInput.focus({ preventScroll: true });
    }
  } else if (isKey(event, "Enter", 13)) {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) await openInput();
    else await activateNavigationItem();
  } else if (isKey(event, "Backspace", 8) && (event.metaKey || event.ctrlKey)) {
    const item = navigationItems[selectedIndex];
    const tab = item?.kind === "split-member"
      ? item.row.tab
      : item?.kind === "row" && item.row.kind === "tab"
        ? item.row.tab
        : null;
    if (tab) {
      event.preventDefault();
      await closeTab(tab.id);
    }
  } else if (isKey(event, "Escape", 27)) {
    closeCommandBar();
  }
});

chrome.tabs.onCreated.addListener(loadTabs);
chrome.tabs.onRemoved.addListener((tabId) => {
  allTabs = allTabs.filter((tab) => tab.id !== tabId);
  updateRows();
});
chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  const index = allTabs.findIndex((candidate) => candidate.id === tabId);
  if (index !== -1) {
    allTabs[index] = tab;
    updateRows();
  }
});
chrome.sessions?.onChanged?.addListener(loadRecentlyClosed);
if (chrome.bookmarks) {
  for (const event of [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
    chrome.bookmarks.onImportEnded
  ].filter(Boolean)) {
    event.addListener(loadBookmarks);
  }
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.commandBarColor) {
    applyCommandBarTheme(document, changes.commandBarColor.newValue);
  }
  if (changes.defaultSplitMode) {
    defaultSplitExpanded = changes.defaultSplitMode.newValue === "expanded";
    splitNavigationKeys.clear();
  }
  if (changes.showFavorites) showFavorites = changes.showFavorites.newValue !== false;
  if (changes.showRecentlyClosed) {
    showRecentlyClosed = changes.showRecentlyClosed.newValue !== false;
  }
  if (changes.resultSectionOrder) {
    resultSectionOrder = normalizeResultSectionOrder(
      changes.resultSectionOrder.newValue
    );
  }
  if (changes.favoriteFolderIds) {
    favoriteFolderIds = Array.isArray(changes.favoriteFolderIds.newValue)
      ? changes.favoriteFolderIds.newValue
      : null;
  }
  updateRows();
});

const storedSettings = await chrome.storage.sync.get({
  defaultSplitMode: "compact",
  commandBarColor: DEFAULT_COMMAND_BAR_COLOR,
  showFavorites: true,
  showRecentlyClosed: true,
  favoriteFolderIds: null,
  resultSectionOrder: DEFAULT_RESULT_SECTION_ORDER
});
applyCommandBarTheme(document, storedSettings.commandBarColor);
defaultSplitExpanded = storedSettings.defaultSplitMode === "expanded";
showFavorites = storedSettings.showFavorites !== false;
showRecentlyClosed = storedSettings.showRecentlyClosed !== false;
resultSectionOrder = normalizeResultSectionOrder(storedSettings.resultSectionOrder);
favoriteFolderIds = Array.isArray(storedSettings.favoriteFolderIds)
  ? storedSettings.favoriteFolderIds
  : null;
updateState = await getExtensionUpdateState();
await Promise.all([loadTabs(), loadBookmarks(), loadRecentlyClosed()]);
queryInput.focus();
