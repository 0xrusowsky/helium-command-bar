import {
  filterRecentlyClosed,
  filterSettings,
  filterTabBlocks,
  hostnameFor,
  resolveInput
} from "./search.js";

const queryInput = document.querySelector("#query");
const resultsElement = document.querySelector("#results");
const resultLabel = document.querySelector("#result-label");
const emptyElement = document.querySelector("#empty");

function closeCommandBar() {
  window.close();
}

let allTabs = [];
let recentlyClosedSessions = [];
let rows = [];
let navigationItems = [];
let selectedIndex = 0;
let defaultSplitExpanded = false;
const splitNavigationKeys = new Set();

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

function updateRows({ resetSelection = false } = {}) {
  const input = queryInput.value;
  const matchedBlocks = filterTabBlocks(allTabs, input, chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1);
  const matchedClosed = filterRecentlyClosed(recentlyClosedSessions, input);
  const matchedSettings = filterSettings(input);
  const launch = launchRow(input);
  const openRows = matchedBlocks.flatMap((block) => block.type === "split"
    ? block.members.map((tab) => ({
        kind: "split-member",
        tab,
        splitKey: block.key,
        splitViewId: block.splitViewId,
        splitSize: block.members.length
      }))
    : [{ kind: "tab", tab: block.members[0] }]);
  rows = [
    ...(launch ? [launch] : []),
    ...matchedSettings.map((setting) => ({ kind: "setting", setting })),
    ...openRows,
    ...matchedClosed.map((closed) => ({ kind: "closed", closed }))
  ];

  if (resetSelection) selectedIndex = 0;

  const totalMatches = matchedSettings.length + openRows.length + matchedClosed.length;
  if (!input.trim()) {
    resultLabel.textContent = `${openRows.length} open · ${matchedClosed.length} recently closed`;
  } else if (totalMatches === 0) {
    resultLabel.textContent = "No matching tabs";
  } else {
    resultLabel.textContent = `${openRows.length} open · ${matchedClosed.length} recently closed`;
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

function makeTabRow(row, index) {
  const { tab } = row;
  const element = document.createElement("li");
  element.className = `result-row tab-row${row.kind === "split-member" ? " split-member-row" : ""}`;
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "favicon-box";
  const fallback = document.createElement("span");
  fallback.className = "favicon-fallback";
  fallback.textContent = (tab.title || hostnameFor(tab) || "T").trim().charAt(0).toLocaleUpperCase();
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
  title.textContent = tab.title || "Untitled tab";
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

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close-tab";
  closeButton.setAttribute("aria-label", `Close ${tab.title || "tab"}`);
  closeButton.title = "Close tab";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await closeTab(tab.id);
  });
  trailing.append(closeButton);

  element.append(iconBox, details, trailing);
  return element;
}

function splitRepresentative(memberRows) {
  return memberRows.find((row) => row.tab.active)?.tab ||
    [...memberRows].sort((left, right) => (right.tab.lastAccessed || 0) - (left.tab.lastAccessed || 0))[0]?.tab;
}

function makeSplitGroup(size, navigationEntered) {
  const group = document.createElement("li");
  group.className = `split-group expanded${navigationEntered ? " navigation-entered" : ""}`;
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `Expanded split view with ${size} tabs`);

  const header = document.createElement("div");
  header.className = "split-group-header";
  header.append(
    createSvgIcon("M4 5.5h7v13H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm9 0h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v-13Z", "split-group-icon"),
    document.createTextNode("Split view"),
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
  fallback.textContent = (tab.title || hostnameFor(tab) || "T").trim().charAt(0).toLocaleUpperCase();
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
    const column = document.createElement("button");
    column.type = "button";
    column.className = "split-column";
    column.title = `Open split and focus ${tab.title || "tab"}`;
    const details = document.createElement("span");
    details.className = "split-column-details";
    const title = document.createElement("span");
    title.className = "split-column-title";
    title.textContent = tab.title || "Untitled tab";
    const subtitle = document.createElement("span");
    subtitle.className = "split-column-subtitle";
    subtitle.textContent = hostnameFor(tab);
    details.append(title, subtitle);
    column.append(makeCompactFavicon(tab), details);
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

function makeSettingRow(row, index) {
  const { setting } = row;
  const element = document.createElement("li");
  element.className = "result-row setting-row";
  element.id = `result-${index}`;
  element.setAttribute("role", "option");

  const iconBox = document.createElement("span");
  iconBox.className = "setting-icon-box";
  iconBox.append(createSvgIcon(
    "M8 7V4m0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v9m8-3v3m0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-4V4",
    "setting-icon"
  ));

  const details = document.createElement("span");
  details.className = "result-details";
  const title = document.createElement("span");
  title.className = "result-title";
  title.textContent = setting.title;
  const subtitle = document.createElement("span");
  subtitle.className = "result-subtitle";
  subtitle.textContent = `${setting.description} · Helium settings`;
  details.append(title, subtitle);

  const enterHint = document.createElement("kbd");
  enterHint.className = "enter-hint";
  enterHint.textContent = "↵";
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
    closed: makeResultSection("Recently closed")
  };
  navigationItems = [];
  let rowIndex = 0;

  while (rowIndex < rows.length) {
    const row = rows[rowIndex];
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
    else if (row.kind === "closed") element = makeClosedRow(row, navigationItems.length);
    else if (row.kind === "setting") element = makeSettingRow(row, navigationItems.length);
    else element = makeLaunchRow(row, navigationItems.length);
    const section = row.kind === "launch" || row.kind === "setting"
      ? sections.search
      : row.kind === "closed" ? sections.closed : sections.open;
    section.list.append(bindNavigationItem(element, { kind: "row", row }));
    rowIndex += 1;
  }

  for (const section of Object.values(sections)) {
    if (section.list.childElementCount > 0) fragment.append(section.section);
  }
  resultsElement.replaceChildren(fragment);
  selectedIndex = Math.max(0, Math.min(selectedIndex, navigationItems.length - 1));
  setSelected(selectedIndex, { scroll: false });
}

async function activateTab(tab) {
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
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

async function openSetting(setting) {
  try {
    await chrome.tabs.create({ url: setting.url, active: true });
    closeCommandBar();
  } catch (error) {
    console.error("Could not open settings destination", error);
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
  } else if (item.row.kind === "closed") {
    await restoreSession(item.row.closed);
  } else if (item.row.kind === "setting") {
    await openSetting(item.row.setting);
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
    allTabs = await chrome.tabs.query({});
    updateRows();
  } catch (error) {
    resultLabel.textContent = "Unable to read tabs";
    emptyElement.textContent = "Reload the extension and try again";
    emptyElement.hidden = false;
    console.error("Could not query tabs", error);
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
  updateRows({ resetSelection: true });
});
queryInput.addEventListener("keydown", async (event) => {
  if (event.isComposing) return;

  if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
    event.preventDefault();
    setSelected(selectedIndex + 1);
  } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
    event.preventDefault();
    setSelected(selectedIndex - 1);
  } else if (event.key === "ArrowRight") {
    const item = navigationItems[selectedIndex];
    if (item?.kind === "split-group") {
      event.preventDefault();
      enterSplitNavigation(item);
    }
  } else if (event.key === "ArrowLeft") {
    const item = navigationItems[selectedIndex];
    if (item?.kind === "split-member") {
      event.preventDefault();
      exitSplitNavigation(item);
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) await openInput();
    else await activateNavigationItem();
  } else if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
    const item = navigationItems[selectedIndex];
    const tab = item?.kind === "split-member"
      ? item.row.tab
      : item?.kind === "row" && item.row.kind === "tab" ? item.row.tab : null;
    if (tab) {
      event.preventDefault();
      await closeTab(tab.id);
    }
  } else if (event.key === "Escape") {
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
chrome.sessions.onChanged.addListener(loadRecentlyClosed);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.defaultSplitMode) return;
  defaultSplitExpanded = changes.defaultSplitMode.newValue === "expanded";
  splitNavigationKeys.clear();
  renderRows();
});

const storedSettings = await chrome.storage.sync.get({ defaultSplitMode: "compact" });
defaultSplitExpanded = storedSettings.defaultSplitMode === "expanded";
await Promise.all([loadTabs(), loadRecentlyClosed()]);
queryInput.focus();
