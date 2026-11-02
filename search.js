const ALLOWED_PROTOCOLS = new Set([
  "http:",
  "https:",
  "file:",
  "about:",
  "chrome:",
  "helium:"
]);

export const DEFAULT_RESULT_SECTION_ORDER = Object.freeze([
  "open",
  "favorites",
  "closed"
]);

export function normalizeResultSectionOrder(value) {
  const allowed = new Set(DEFAULT_RESULT_SECTION_ORDER);
  const normalized = [];
  for (const key of Array.isArray(value) ? value : []) {
    if (allowed.has(key) && !normalized.includes(key)) normalized.push(key);
  }
  for (const key of DEFAULT_RESULT_SECTION_ORDER) {
    if (!normalized.includes(key)) normalized.push(key);
  }
  return normalized;
}

export const SETTINGS_ENTRIES = Object.freeze([
  Object.freeze({
    id: "extension-settings",
    title: "Helium Command Bar settings",
    url: "options.html",
    description: "Configure the Helium Command Bar extension",
    keywords: "extension options preferences configuration command bar",
    icon: "settings",
    extensionOptions: true,
    hidden: true,
    aliases: []
  }),
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
  }),
  // Extensions cannot enumerate or open other profiles directly, so profile
  // commands route through Chromium's own profile picker and settings pages.
  Object.freeze({
    id: "switch-profile",
    title: "Switch profile",
    url: "chrome://profile-picker",
    description: "Choose another Helium profile",
    keywords: "profiles person people user account switch change open work personal",
    icon: "profile",
    aliases: ["chrome://profile-picker", "helium://profile-picker"]
  }),
  Object.freeze({
    id: "add-profile",
    title: "Add profile",
    url: "chrome://profile-picker/new-profile",
    description: "Create a new Helium profile",
    keywords: "profiles new create person people user account",
    icon: "profile",
    aliases: ["chrome://profile-picker/new-profile", "helium://profile-picker/new-profile"]
  }),
  Object.freeze({
    id: "manage-profile",
    title: "Customize profile",
    url: "helium://settings/manageProfile",
    description: "Change this profile's name, avatar, and color",
    keywords: "profiles edit rename avatar color person people user account",
    icon: "profile",
    aliases: ["helium://settings/manageProfile", "chrome://settings/manageProfile"]
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

  let substringIndex = field.indexOf(token);
  if (token.length <= 2) {
    while (substringIndex !== -1) {
      if (/[^\p{L}\p{N}]/u.test(field[substringIndex - 1] || "")) {
        return (400 - Math.min(substringIndex, 100)) * weight;
      }
      substringIndex = field.indexOf(token, substringIndex + 1);
    }
    return null;
  }

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
      else if (token.length > 2 && part.includes(token)) score = 250;
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
    .filter((setting) => !setting.hidden)
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

// Stroke paths in a 24×24 view box, rendered by the overlay and the popup.
export const ACTION_ICON_PATHS = Object.freeze({
  copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Zm-4 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  reload: "M21 12a9 9 0 1 1-3-6.7L21 8m0-5v5h-5",
  duplicate: "M8 8h12v12H8V8Zm-4 8V4h12",
  mute: "M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6",
  unmute: "M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7",
  back: "M19 12H5m6-6-6 6 6 6",
  forward: "M5 12h14m-6-6 6 6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  "close-right": "M4 12h10m-4-4 4 4-4 4M20 5v14",
  "new-window": "M14 5h5v5m0-5L10 14m7 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4",
  window: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 4h18",
  incognito: "M2 11h20M5 11l2-6h10l2 6M9.5 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm-10 0h5",
  "zoom-in": "m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM10.5 8v5M8 10.5h5",
  "zoom-out": "m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM8 10.5h5",
  "zoom-reset": "m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  split: "M4 5.5h7v13H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm9 0h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v-13Z",
  "split-close": "M4 5.5h7v13H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm10.5 4 4 5m0-5-4 5"
});

const MAX_TAB_ACTIONS = 5;

export function filterTabActions(query, currentTab) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !currentTab?.id) return [];
  const currentUrl = currentTab.url || currentTab.pendingUrl || "";

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
    },
    ...(currentUrl ? [{
      id: "copy-url",
      title: "Copy URL",
      description: currentUrl,
      keywords: "copy current page link address url clipboard share",
      url: currentUrl,
      icon: "copy"
    }] : []),
    ...(isSplitTab(currentTab) ? [
      {
        id: "focus-other-pane",
        title: "Switch split pane",
        description: "Focus the other pane of this split view",
        keywords: "split view pane switch focus other side",
        icon: "split"
      },
      {
        id: "close-other-pane",
        title: "Close other pane",
        description: "Close the other pane and keep this tab",
        keywords: "split view pane close other unsplit exit",
        icon: "split-close"
      },
      {
        id: "close-split",
        title: "Close split view",
        description: "Close every tab in this split view",
        keywords: "split view close both panes tabs",
        icon: "close"
      }
    ] : []),
    {
      id: "reload",
      title: "Reload tab",
      description: "Reload the current page",
      keywords: "refresh reload page",
      icon: "reload"
    },
    {
      id: "hard-reload",
      title: "Hard reload tab",
      description: "Reload the current page, ignoring cached content",
      keywords: "refresh reload bypass cache force",
      icon: "reload"
    },
    {
      id: "duplicate",
      title: "Duplicate tab",
      description: "Open a copy of the current tab",
      keywords: "duplicate clone copy tab",
      icon: "duplicate"
    },
    {
      id: "toggle-mute",
      title: currentTab.mutedInfo?.muted ? "Unmute tab" : "Mute tab",
      description: currentTab.mutedInfo?.muted
        ? "Allow the current tab to play sound"
        : "Silence the current tab",
      keywords: "mute unmute sound audio silence volume",
      icon: currentTab.mutedInfo?.muted ? "unmute" : "mute"
    },
    {
      id: "go-back",
      title: "Go back",
      description: "Return to the previous page in this tab",
      keywords: "back history previous navigate",
      icon: "back"
    },
    {
      id: "go-forward",
      title: "Go forward",
      description: "Go to the next page in this tab",
      keywords: "forward history next navigate",
      icon: "forward"
    },
    {
      id: "close-tab",
      title: "Close tab",
      description: "Close the current tab",
      keywords: "close tab remove",
      icon: "close"
    },
    {
      id: "close-other-tabs",
      title: "Close other tabs",
      description: "Close unpinned tabs in this window except the current tab",
      keywords: "close other tabs remove others window",
      icon: "close"
    },
    {
      id: "close-tabs-right",
      title: "Close tabs to the right",
      description: "Close unpinned tabs after the current tab",
      keywords: "close tabs right after remove",
      icon: "close-right"
    },
    {
      id: "new-window",
      title: "New window",
      description: "Open a new browser window",
      keywords: "new window open create",
      icon: "window"
    },
    {
      id: "new-incognito-window",
      title: "New incognito window",
      description: "Open a new private window",
      keywords: "new incognito private window open create",
      icon: "incognito"
    },
    ...(/^(https?|file):/i.test(currentUrl) ? [{
      id: "open-in-incognito",
      title: "Open page in incognito window",
      description: "Reopen the current page in a private window",
      keywords: "incognito private window open page current",
      icon: "incognito"
    }] : []),
    {
      id: "move-to-new-window",
      title: "Move tab to new window",
      description: "Open the current tab in its own window",
      keywords: "move tab new window detach separate",
      icon: "new-window"
    },
    {
      id: "zoom-in",
      title: "Zoom in",
      description: "Make the current page larger",
      keywords: "zoom in larger bigger magnify",
      icon: "zoom-in"
    },
    {
      id: "zoom-out",
      title: "Zoom out",
      description: "Make the current page smaller",
      keywords: "zoom out smaller",
      icon: "zoom-out"
    },
    {
      id: "zoom-reset",
      title: "Reset zoom",
      description: "Return the current page to its default size",
      keywords: "zoom reset actual size default 100",
      icon: "zoom-reset"
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
    .slice(0, MAX_TAB_ACTIONS)
    .map(({ action }) => ACTION_ICON_PATHS[action.icon]
      ? { ...action, iconPath: ACTION_ICON_PATHS[action.icon] }
      : action);
}

const MAX_EXTENSION_RESULTS = 5;

export function filterExtensions(extensions, query, selfId) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  return (extensions || [])
    .filter((extension) => extension.type === "extension" && extension.id !== selfId)
    .map((extension) => ({
      extension,
      score: scoreTab({ title: extension.name || "", url: "" }, normalizedQuery)
    }))
    .filter(({ score }) => score !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EXTENSION_RESULTS)
    .map(({ extension }) => extension);
}

export function extensionRows(extension) {
  const parentSettingId = `extension:${extension.id}`;
  const child = (action, title, description, icon) => ({
    kind: "extension-action",
    parentSettingId,
    extensionId: extension.id,
    extensionAction: action,
    subtitle: description,
    setting: { id: `${parentSettingId}:${action}`, title, description, icon }
  });
  return [
    {
      kind: "extension",
      expandable: true,
      extensionId: extension.id,
      subtitle: `${extension.enabled ? "Enabled" : "Disabled"} extension${extension.version ? ` · ${extension.version}` : ""}`,
      setting: {
        id: parentSettingId,
        title: extension.name,
        description: extension.description || "",
        icon: "extensions"
      }
    },
    ...(extension.optionsUrl
      ? [child("options", "Open options", `Configure ${extension.name}`, "settings")]
      : []),
    ...(extension.mayDisable
      ? [child(
          "toggle",
          extension.enabled ? "Disable" : "Enable",
          `${extension.enabled ? "Turn off" : "Turn on"} ${extension.name}`,
          "extensions"
        )]
      : []),
    child("details", "Show details", "Permissions, site access, and shortcuts", "extensions")
  ];
}

const ZOOM_LEVELS = Object.freeze([0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]);

export function nextZoomLevel(current, direction) {
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > current + 0.001) ?? ZOOM_LEVELS.at(-1);
  return ZOOM_LEVELS.findLast((level) => level < current - 0.001) ?? ZOOM_LEVELS[0];
}

// Pages that host the overlay must never load a tab's own favicon URL: a
// public page requesting http://localhost/favicon.ico or a LAN address
// triggers Chromium's Local Network Access prompt. The extension favicon
// endpoint serves the browser's cached icon without any page-initiated fetch.
export function cachedFaviconUrl(faviconEndpoint, pageUrl, favIconUrl = "") {
  if (favIconUrl.startsWith("data:")) return favIconUrl;
  if (!/^(https?|file):/i.test(pageUrl || "")) return "";
  const url = new URL(faviconEndpoint);
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.href;
}

export function getSettingForTab(tab) {
  const url = normalize(tab?.url || tab?.pendingUrl || "").replace(/[?#].*$/, "").replace(/\/$/, "");
  if (/^chrome-extension:\/\/[^/]+\/options\.html$/.test(url)) {
    return getSettingById("extension-settings");
  }
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

export function duplicateTabIds(tabs, preferredTabId) {
  const tabsByUrl = new Map();
  for (const tab of tabs || []) {
    const url = tab?.url || tab?.pendingUrl || "";
    if (!url) continue;
    if (!tabsByUrl.has(url)) tabsByUrl.set(url, []);
    tabsByUrl.get(url).push(tab);
  }

  const duplicateIds = [];
  for (const matchingTabs of tabsByUrl.values()) {
    if (matchingTabs.length < 2) continue;
    const survivor = [...matchingTabs].sort((left, right) =>
      Number(right.id === preferredTabId) - Number(left.id === preferredTabId) ||
      Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
      Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
      (right.lastAccessed || 0) - (left.lastAccessed || 0)
    )[0];
    duplicateIds.push(...matchingTabs
      .filter((tab) => tab.id !== survivor.id)
      .map((tab) => tab.id)
      .filter(Number.isInteger));
  }
  return duplicateIds;
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
    (bookmark.folderIds || [bookmark.parentFolderId]).some((folderId) =>
      selectedFolders.has(folderId)
    )
  );
}

export function filterBookmarks(
  bookmarks,
  query,
  representedOpenTabs,
  selectedFolderIds = null,
  limit = 100
) {
  const openUrls = new Set((representedOpenTabs || [])
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

export function filterHistory(historyItems, query, excludedUrls = [], limit = 50) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const excluded = new Set((excludedUrls || []).map(bookmarkUrlKey).filter(Boolean));
  const seen = new Set();
  const scored = (historyItems || [])
    .filter((item) => {
      const key = bookmarkUrlKey(item?.url || "");
      if (!key || excluded.has(key) || seen.has(key) || isIgnoredRecentlyClosedTab(item)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      item: {
        title: cleanTabTitle(item) || item.url,
        url: item.url,
        lastVisitTime: item.lastVisitTime || 0,
        visitCount: item.visitCount || 0,
        typedCount: item.typedCount || 0
      },
      score: scoreTab(item, normalizedQuery)
    }))
    .filter(({ score }) => score !== null);

  scored.sort((left, right) =>
    right.score - left.score ||
    (right.item.typedCount - left.item.typedCount) ||
    (right.item.visitCount - left.item.visitCount) ||
    (right.item.lastVisitTime - left.item.lastVisitTime)
  );
  return scored.slice(0, limit).map(({ item }) => item);
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
