const ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "file:",
  "about:",
  "chrome:",
  "helium:"
]);

export const SETTINGS_ENTRIES = Object.freeze([
  Object.freeze({
    id: "settings",
    title: "Settings",
    url: "helium://settings",
    description: "Open Helium settings",
    keywords: "preferences configuration browser settings",
    icon: "settings",
    aliases: ["helium://settings", "chrome://settings"]
  }),
  Object.freeze({
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    url: "helium://settings/system/shortcuts",
    description: "Customize browser keyboard shortcuts",
    keywords: "hotkeys key bindings commands system settings",
    icon: "keyboard",
    aliases: [
      "helium://settings/system/shortcuts",
      "chrome://settings/system/shortcuts"
    ]
  }),
  Object.freeze({
    id: "extensions",
    title: "Extensions",
    url: "helium://extensions",
    description: "Manage browser extensions",
    keywords: "extensions add-ons addons plugins manage installed developer mode",
    icon: "extensions",
    aliases: ["helium://extensions", "chrome://extensions"]
  }),
  Object.freeze({
    id: "bookmarks",
    title: "Manage bookmarks",
    url: "helium://bookmarks",
    description: "Open the browser bookmark manager",
    keywords: "bookmarks favorites favourites manage edit organize folders library",
    icon: "bookmarks",
    aliases: ["helium://bookmarks", "chrome://bookmarks"]
  })
]);

export function normalize(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function subsequenceScore(needle, haystack) {
  if (!needle || !haystack) return null;

  let bestScore = null;
  let start = haystack.indexOf(needle[0]);
  while (start !== -1) {
    let position = start;
    let score = start === 0 || /[\s/._-]/.test(haystack[start - 1]) ? 22 : 8;
    let matched = true;

    for (let index = 1; index < needle.length; index += 1) {
      const next = haystack.indexOf(needle[index], position + 1);
      if (next === -1) {
        matched = false;
        break;
      }

      const gap = next - position - 1;
      const isBoundary = next === 0 || /[\s/._-]/.test(haystack[next - 1]);
      score += (isBoundary ? 22 : 8) - Math.min(gap, 7);
      position = next;
    }

    if (matched) {
      const span = position - start + 1;
      // Fuzzy matches must remain locally dense. Without this constraint, a
      // query such as "youtu" can match unrelated long titles merely because
      // those five letters occur somewhere in order across the whole string.
      const maximumSpan = needle.length + Math.max(2, Math.floor(needle.length * 0.75));
      if (span <= maximumSpan) {
        score += needle.length * 10 - (span - needle.length) * 4;
        bestScore = Math.max(bestScore ?? -Infinity, score);
      }
    }

    start = haystack.indexOf(needle[0], start + 1);
  }

  return bestScore;
}

function fieldScore(token, field, weight) {
  if (!field) return null;
  if (field === token) return 1000 * weight;
  if (field.startsWith(token)) return (600 - token.length) * weight;

  const substringIndex = field.indexOf(token);
  if (substringIndex !== -1) {
    return (400 - Math.min(substringIndex, 100)) * weight;
  }

  const fuzzy = subsequenceScore(token, field);
  return fuzzy === null ? null : fuzzy * weight;
}

function urlComponentScore(token, value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    const hostParts = normalize(url.hostname).split(".").filter(Boolean);
    const pathParts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return normalize(decodeURIComponent(part));
        } catch {
          return normalize(part);
        }
      });
    const parts = [...hostParts, ...pathParts];
    let best = null;

    parts.forEach((part, index) => {
      const isFinalPathPart = pathParts.length > 0 && index === parts.length - 1;
      let score = null;
      if (part === token) score = isFinalPathPart ? 950 : 800;
      else if (part.startsWith(token)) score = isFinalPathPart ? 600 : 450;
      else if (part.includes(token)) score = 250;
      if (score !== null) best = Math.max(best ?? -Infinity, score);
    });
    return best;
  } catch {
    return null;
  }
}

export function scoreTab(tab, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const title = normalize(tab.searchTitle || tab.title || "");
  const rawUrl = tab.url || tab.pendingUrl || "";
  const url = normalize(rawUrl);
  const tokens = normalizedQuery.split(/\s+/);
  let total = 0;

  for (const token of tokens) {
    const titleScore = fieldScore(token, title, 1.4);
    const urlScore = fieldScore(token, url, 1);
    const componentScore = urlComponentScore(token, rawUrl);
    const best = Math.max(titleScore ?? -1, urlScore ?? -1, componentScore ?? -1);
    if (best < 0) return null;
    total += best;
  }

  if (title === normalizedQuery || url === normalizedQuery) total += 2000;
  return total;
}

export function filterSettings(query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  return SETTINGS_ENTRIES
    .map((setting) => ({
      setting,
      score: scoreTab({
        title: `${setting.title} ${setting.keywords}`,
        url: setting.url
      }, normalizedQuery)
    }))
    .filter(({ score }) => score !== null)
    .sort((left, right) => right.score - left.score)
    .map(({ setting }) => setting);
}

export function getSettingById(id) {
  return SETTINGS_ENTRIES.find((setting) => setting.id === id) || null;
}

export function filterTabActions(query, currentTab) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !currentTab?.id) return [];

  const actions = [
    {
      id: "toggle-pin",
      title: currentTab.pinned ? "Unpin tab" : "Pin tab",
      description: currentTab.pinned
        ? "Move the current tab back to regular tabs"
        : "Keep the current tab pinned in the tab strip",
      keywords: "pin pinned unpin tab keep",
      nextPinned: !currentTab.pinned,
      icon: "pin"
    },
    {
      id: "toggle-favorite",
      title: currentTab.bookmarkId ? "Remove from Favorites" : "Add to Favorites",
      description: currentTab.bookmarkId
        ? "Remove the current page from browser bookmarks"
        : "Add the current page to browser bookmarks",
      keywords: "favorite favourite star bookmark add remove current page",
      nextFavorite: !currentTab.bookmarkId,
      bookmarkId: currentTab.bookmarkId || null,
      icon: "favorite"
    }
  ];

  return actions
    .map((action) => ({
      action,
      score: scoreTab({
        title: `${action.title} ${action.keywords}`,
        url: ""
      }, normalizedQuery)
    }))
    .filter(({ score }) => score !== null)
    .sort((left, right) => right.score - left.score)
    .map(({ action }) => action);
}

export function getSettingForTab(tab) {
  const url = normalize(tab?.url || tab?.pendingUrl || "").replace(/[?#].*$/, "").replace(/\/$/, "");
  let bestMatch = null;
  let bestLength = -1;

  for (const setting of SETTINGS_ENTRIES) {
    for (const alias of setting.aliases || [setting.url]) {
      const normalizedAlias = normalize(alias).replace(/\/$/, "");
      if (
        (url === normalizedAlias || url.startsWith(`${normalizedAlias}/`)) &&
        normalizedAlias.length > bestLength
      ) {
        bestMatch = setting;
        bestLength = normalizedAlias.length;
      }
    }
  }
  return bestMatch;
}

export function cleanTabTitle(tab) {
  const title = tab?.title || "";
  const value = tab?.url || tab?.pendingUrl || "";
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase();
    if (hostname === "github.com" || hostname.endsWith(".github.com")) {
      return title.replace(/^github\s*[-–—]\s*/i, "").trim() || title;
    }
  } catch {
    // Keep the original title for malformed and internal URLs.
  }
  return title;
}

export function displayTabTitle(tab) {
  return tab?.bookmarkTitle || cleanTabTitle(tab);
}

export function filterTabs(tabs, query) {
  const normalizedQuery = normalize(query);
  const scored = tabs
    .map((tab) => ({ tab, score: scoreTab(tab, normalizedQuery) }))
    .filter(({ score }) => score !== null);

  scored.sort((left, right) => {
    if (normalizedQuery && right.score !== left.score) return right.score - left.score;
    if (Boolean(right.tab.active) !== Boolean(left.tab.active)) return right.tab.active ? 1 : -1;
    return (right.tab.lastAccessed || 0) - (left.tab.lastAccessed || 0);
  });

  return scored.map(({ tab }) => tab);
}

export function bookmarkUrlKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return normalize(value || "");
  }
}

export function flattenBookmarks(nodes) {
  const bookmarks = [];

  function visit(node, folders) {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        folder: folders.map((folder) => folder.title).filter(Boolean).join(" / "),
        folderIds: folders.map((folder) => folder.id),
        parentFolderId: folders.at(-1)?.id || null,
        dateAdded: node.dateAdded || 0,
        lastAccessed: node.dateLastUsed || node.dateAdded || 0
      });
      return;
    }

    const nextFolders = node.id
      ? [...folders, { id: node.id, title: node.title || "" }]
      : folders;
    for (const child of node.children || []) visit(child, nextFolders);
  }

  for (const node of nodes || []) visit(node, []);
  return bookmarks;
}

export function attachBookmarkMetadata(tabs, bookmarks) {
  const bookmarksByUrl = new Map();
  for (const bookmark of [...(bookmarks || [])].sort((left, right) =>
    (right.lastAccessed || right.dateAdded || 0) - (left.lastAccessed || left.dateAdded || 0)
  )) {
    const key = bookmarkUrlKey(bookmark.url);
    if (key && !bookmarksByUrl.has(key)) bookmarksByUrl.set(key, bookmark);
  }

  return (tabs || []).map((tab) => {
    const bookmark = bookmarksByUrl.get(bookmarkUrlKey(tab.url || tab.pendingUrl || ""));
    if (!bookmark) return tab;
    return {
      ...tab,
      bookmarkId: bookmark.id,
      bookmarkTitle: bookmark.title || tab.title || "",
      searchTitle: `${tab.title || ""} ${bookmark.title || ""}`.trim()
    };
  });
}

export function bookmarksInFolders(bookmarks, selectedFolderIds = null) {
  if (!Array.isArray(selectedFolderIds)) return bookmarks || [];
  const selectedFolders = new Set(selectedFolderIds);
  return (bookmarks || []).filter((bookmark) =>
    selectedFolders.has(bookmark.parentFolderId)
  );
}

export function filterBookmarks(
  bookmarks,
  query,
  openTabs,
  selectedFolderIds = null,
  limit = 100
) {
  const openUrls = new Set((openTabs || [])
    .map((tab) => bookmarkUrlKey(tab.url || tab.pendingUrl || ""))
    .filter(Boolean));
  return filterTabs(
    bookmarksInFolders(bookmarks, selectedFolderIds).filter((bookmark) =>
      !openUrls.has(bookmarkUrlKey(bookmark.url))
    ),
    query
  ).slice(0, limit);
}

export function isSplitTab(tab, splitViewIdNone = -1) {
  return (
    tab?.splitViewId !== undefined &&
    tab.splitViewId !== null &&
    tab.splitViewId !== splitViewIdNone
  );
}

function compareTabs(left, right) {
  return (left.index ?? 0) - (right.index ?? 0) || (left.id ?? 0) - (right.id ?? 0);
}

export function buildTabBlocks(tabs, splitViewIdNone = -1) {
  const blocksByKey = new Map();

  for (const tab of [...tabs].sort(compareTabs)) {
    const split = isSplitTab(tab, splitViewIdNone);
    const key = split
      ? `split:${tab.windowId}:${tab.splitViewId}`
      : `tab:${tab.id}`;
    let block = blocksByKey.get(key);

    if (!block) {
      block = {
        key,
        type: split ? "split" : "single",
        splitViewId: split ? tab.splitViewId : null,
        windowId: tab.windowId,
        members: []
      };
      blocksByKey.set(key, block);
    }
    block.members.push(tab);
  }

  return [...blocksByKey.values()].map((block) => {
    block.members.sort(compareTabs);
    const completeSplit = block.type === "split" && block.members.length > 1;
    const representative =
      block.members.find((tab) => tab.active) ||
      [...block.members].sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
    return {
      ...block,
      type: completeSplit ? "split" : "single",
      splitViewId: completeSplit ? block.splitViewId : null,
      representative,
      active: block.members.some((tab) => tab.active),
      lastAccessed: Math.max(...block.members.map((tab) => tab.lastAccessed || 0))
    };
  });
}

export function filterTabBlocks(tabs, query, splitViewIdNone = -1) {
  const normalizedQuery = normalize(query);
  const scored = buildTabBlocks(tabs, splitViewIdNone)
    .map((block) => ({
      block,
      score: scoreTab({
        title: block.members.map((tab) => tab.searchTitle || tab.title || "").join(" "),
        url: block.members.map((tab) => tab.url || tab.pendingUrl || "").join(" ")
      }, normalizedQuery)
    }))
    .filter(({ score }) => score !== null);

  scored.sort((left, right) => {
    if (normalizedQuery && right.score !== left.score) return right.score - left.score;
    if (right.block.active !== left.block.active) return right.block.active ? 1 : -1;
    return right.block.lastAccessed - left.block.lastAccessed;
  });

  return scored.map(({ block }) => block);
}

export function isIgnoredRecentlyClosedTab(tab) {
  const title = normalize(tab?.title || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
  const url = normalize(tab?.url || tab?.pendingUrl || "");

  const isSettingsPage = /^(?:helium|chrome):\/\/(?:settings|extensions|bookmarks)(?:\/|$)/.test(url);
  const isNewTabPage = /^(?:helium|chrome):\/\/(?:newtab|new-tab)(?:\/|$)/.test(url) ||
    url === "about:newtab";
  const isNewSplitPage = url.includes("tab-search.top-chrome/split_new_tab_page.html") ||
    /\/split-picker\.html(?:[?#]|$)/.test(url);
  const isSettingsTitle = title === "settings" ||
    title === "keyboard shortcuts" ||
    title === "extensions" ||
    title === "bookmarks" ||
    title === "bookmark manager" ||
    title === "manage bookmarks" ||
    /^settings\s*-\s*keyboard shortcuts$/.test(title);
  const isPlaceholderTitle = title === "new tab" || title === "new split tab";

  return isSettingsPage || isNewTabPage || isNewSplitPage || isSettingsTitle || isPlaceholderTitle;
}

export function sessionToItem(session) {
  const sessionId = session?.tab?.sessionId || session?.window?.sessionId || session?.sessionId;
  if (!sessionId) return null;

  const tabs = (session.tab ? [session.tab] : (session.window?.tabs || []))
    .filter((tab) => !isIgnoredRecentlyClosedTab(tab));
  if (!tabs.length) return null;

  const primaryTab = tabs.find((tab) => tab.active) || tabs[0];
  const isWindow = Boolean(session.window);
  const extraTabs = Math.max(0, tabs.length - 1);
  const primaryTitle = cleanTabTitle(primaryTab) || "Untitled tab";

  return {
    sessionId,
    title: isWindow && extraTabs ? `${primaryTitle} + ${extraTabs} more` : primaryTitle,
    url: primaryTab.url || primaryTab.pendingUrl || "",
    favIconUrl: primaryTab.favIconUrl || "",
    tabCount: tabs.length,
    isWindow,
    lastModified: session.lastModified || 0,
    searchableTitle: tabs.map((tab) => tab.title || "").join(" "),
    searchableUrl: tabs.map((tab) => tab.url || tab.pendingUrl || "").join(" ")
  };
}

export function filterRecentlyClosed(sessions, query) {
  const normalizedQuery = normalize(query);
  const scored = sessions
    .map(sessionToItem)
    .filter(Boolean)
    .map((item) => ({
      item,
      score: scoreTab({ title: item.searchableTitle, url: item.searchableUrl }, normalizedQuery)
    }))
    .filter(({ score }) => score !== null);

  scored.sort((left, right) => {
    if (normalizedQuery && right.score !== left.score) return right.score - left.score;
    return right.item.lastModified - left.item.lastModified;
  });

  return scored.map(({ item }) => item);
}

function isLikelyHost(value) {
  const host = value.split(/[/?#]/, 1)[0];
  if (/^localhost(?::\d+)?$/i.test(host)) return true;
  if (/^\[(?:[0-9a-f:]+)](?::\d+)?$/i.test(host)) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(host)) return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?$/i.test(host);
}

export function resolveInput(input) {
  const value = input.trim();
  if (!value) return null;

  const explicitScheme = value.match(/^([a-z][a-z\d+.-]*):/i);
  if (explicitScheme) {
    const protocol = `${explicitScheme[1].toLocaleLowerCase()}:`;
    if (!ALLOWED_PROTOCOLS.has(protocol)) return { kind: "search", text: value };

    try {
      const url = new URL(value);
      return { kind: "url", url: url.href, display: value };
    } catch {
      // Internal browser URLs are not all accepted by URL(), but Chromium may open them.
      if (protocol === "about:" || protocol === "chrome:" || protocol === "helium:") {
        return { kind: "url", url: value, display: value };
      }
      return { kind: "search", text: value };
    }
  }

  if (!/\s/.test(value) && isLikelyHost(value)) {
    const url = new URL(`https://${value}`);
    return { kind: "url", url: url.href, display: value };
  }

  return { kind: "search", text: value };
}

export function hostnameFor(tab) {
  const value = tab.url || tab.pendingUrl || "";
  try {
    const url = new URL(value);
    return url.hostname || url.protocol.replace(":", "");
  } catch {
    return value;
  }
}
