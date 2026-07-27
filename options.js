import {
  DEFAULT_RESULT_SECTION_ORDER,
  normalizeResultSectionOrder
} from "./search.js";
import { extensionIconDataUrl } from "./icon.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  applyCommandBarTheme,
  normalizeThemeColor
} from "./theme.js";

const DEFAULT_MODE = "compact";
const VALID_MODES = new Set(["compact", "expanded"]);
const status = document.querySelector("#save-status");
const blurStatus = document.querySelector("#blur-status");
const blurToggle = document.querySelector("#blur-inactive-split");
const resultsStatus = document.querySelector("#results-status");
const duplicatesStatus = document.querySelector("#duplicates-status");
const duplicateTabsToggle = document.querySelector("#close-duplicate-tabs");
const themeStatus = document.querySelector("#theme-status");
const themeColorInput = document.querySelector("#command-bar-color");
const themeColorText = document.querySelector("#command-bar-color-text");
const extensionIcon = document.querySelector("#extension-icon");
const themePresets = [...document.querySelectorAll("[data-color]")];
const favoritesToggle = document.querySelector("#show-favorites");
const resultSectionOrderList = document.querySelector("#result-section-order");
const recentlyClosedToggle = document.querySelector("#show-recently-closed");
const allFoldersToggle = document.querySelector("#all-favorite-folders");
const folderOptions = document.querySelector("#favorite-folder-options");
const folderList = document.querySelector("#favorite-folder-list");
const choices = [...document.querySelectorAll('input[name="defaultSplitMode"]')];
const arcSetupStatus = document.querySelector("#arc-setup-status");
const arcSetupCheckboxes = [...document.querySelectorAll("[data-setup-step]")];
const heliumSettingButtons = [...document.querySelectorAll(".open-helium-setting")];
const commandAssignments = document.querySelector("#command-assignments");
const coreStatus = document.querySelector("#core-status");
const coreSetupMessage = document.querySelector("#core-setup-message");
const refreshCommandsButton = document.querySelector("#refresh-commands");
const importCoreKarabinerLink = document.querySelector("#import-core-karabiner");
const openExtensionShortcutsButton = document.querySelector("#open-extension-shortcuts");
const BLUR_PERMISSION = { origins: ["<all_urls>"] };
const KARABINER_BASE_URL = "https://raw.githubusercontent.com/0xrusowsky/helium-command-bar/main/integrations";
const CORE_KARABINER_RULE_URL = `${KARABINER_BASE_URL}/karabiner-core.json`;
const CORE_COMMANDS = Object.freeze({
  "open-command-bar": "Open command bar",
  "cycle-split-pane": "Switch split pane",
  "next-tab-block": "Next tab block",
  "previous-tab-block": "Previous tab block"
});
const CORE_SHORTCUTS = Object.freeze({
  "open-command-bar": "⇧⌘Space",
  "cycle-split-pane": "⌃⇧↑",
  "next-tab-block": "⌃⇧→",
  "previous-tab-block": "⌃⇧←"
});
let statusTimer;
let blurStatusTimer;
let resultsStatusTimer;
let duplicatesStatusTimer;
let themeStatusTimer;
let favoriteFolderIds = null;
let folderEntries = [];
let resultSectionOrder = [...DEFAULT_RESULT_SECTION_ORDER];

function selectMode(mode) {
  const normalizedMode = VALID_MODES.has(mode) ? mode : DEFAULT_MODE;
  for (const choice of choices) choice.checked = choice.value === normalizedMode;
}

function showSaved() {
  clearTimeout(statusTimer);
  status.textContent = "Saved";
  status.classList.add("visible");
  statusTimer = setTimeout(() => status.classList.remove("visible"), 1600);
}

function showBlurStatus(text, error = false) {
  clearTimeout(blurStatusTimer);
  blurStatus.textContent = text;
  blurStatus.classList.toggle("error", error);
  blurStatus.classList.add("visible");
  blurStatusTimer = setTimeout(() => blurStatus.classList.remove("visible"), 2600);
}

function showThemeStatus() {
  clearTimeout(themeStatusTimer);
  themeStatus.textContent = "Saved";
  themeStatus.classList.add("visible");
  themeStatusTimer = setTimeout(() => themeStatus.classList.remove("visible"), 1600);
}

function setThemeColor(value) {
  const color = normalizeThemeColor(value);
  applyCommandBarTheme(document, color);
  extensionIcon.src = extensionIconDataUrl(color);
  themeColorInput.value = color;
  themeColorText.value = color;
  for (const preset of themePresets) {
    const selected = preset.dataset.color.toLocaleLowerCase() === color;
    preset.classList.toggle("selected", selected);
    preset.setAttribute("aria-pressed", String(selected));
  }
  return color;
}

async function saveThemeColor(value) {
  const color = setThemeColor(value);
  await chrome.storage.sync.set({ commandBarColor: color });
  showThemeStatus();
}

function showResultsStatus(text = "Saved") {
  clearTimeout(resultsStatusTimer);
  resultsStatus.textContent = text;
  resultsStatus.classList.add("visible");
  resultsStatusTimer = setTimeout(() => resultsStatus.classList.remove("visible"), 1800);
}

function showDuplicatesStatus() {
  clearTimeout(duplicatesStatusTimer);
  duplicatesStatus.textContent = "Saved";
  duplicatesStatus.classList.add("visible");
  duplicatesStatusTimer = setTimeout(() => duplicatesStatus.classList.remove("visible"), 1800);
}

function renderResultSectionOrder(value) {
  resultSectionOrder = normalizeResultSectionOrder(value);
  const labels = {
    open: "Open tabs",
    favorites: "Bookmarks",
    closed: "Recently closed"
  };
  const rows = resultSectionOrder.map((key, index) => {
    const row = document.createElement("li");
    row.className = "section-order-row";
    const label = document.createElement("span");
    label.textContent = labels[key];
    const controls = document.createElement("span");
    controls.className = "section-order-controls";

    for (const [direction, symbol, title] of [
      [-1, "↑", `Move ${labels[key]} up`],
      [1, "↓", `Move ${labels[key]} down`]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.disabled = index + direction < 0 || index + direction >= resultSectionOrder.length;
      button.addEventListener("click", async () => {
        const nextOrder = [...resultSectionOrder];
        const targetIndex = index + direction;
        [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
        renderResultSectionOrder(nextOrder);
        await chrome.storage.sync.set({ resultSectionOrder: nextOrder });
        showResultsStatus();
      });
      controls.append(button);
    }
    row.append(label, controls);
    return row;
  });
  resultSectionOrderList.replaceChildren(...rows);
}

function collectBookmarkFolders(nodes) {
  const folders = [];

  function visit(node, depth, ancestors) {
    if (node.url) return;
    const hasVisibleTitle = Boolean(node.title);
    const nextDepth = hasVisibleTitle ? depth + 1 : depth;
    const nextAncestors = hasVisibleTitle ? [...ancestors, node.id] : ancestors;
    if (hasVisibleTitle) {
      folders.push({ id: node.id, title: node.title, depth, ancestors });
    }
    for (const child of node.children || []) visit(child, nextDepth, nextAncestors);
  }

  for (const node of nodes || []) visit(node, 0, []);
  return folders;
}

function updateArcSetup(completedSteps) {
  const completed = new Set(Array.isArray(completedSteps) ? completedSteps : []);
  for (const checkbox of arcSetupCheckboxes) {
    checkbox.checked = completed.has(checkbox.dataset.setupStep);
    checkbox.closest(".setup-step")?.classList.toggle("completed", checkbox.checked);
  }
  const completedCount = arcSetupCheckboxes.filter((checkbox) => checkbox.checked).length;
  const setupComplete = completedCount === arcSetupCheckboxes.length;
  arcSetupStatus.textContent = setupComplete ? "Complete" : `${completedCount} of ${arcSetupCheckboxes.length}`;
  arcSetupStatus.classList.toggle("ready", setupComplete);
  arcSetupStatus.classList.toggle("incomplete", !setupComplete);
}

function collectCompletedSetupSteps() {
  return arcSetupCheckboxes
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.dataset.setupStep);
}

function updateFolderAvailability() {
  const enabled = favoritesToggle.checked;
  folderOptions.classList.toggle("disabled", !enabled);
  allFoldersToggle.disabled = !enabled;
  for (const entry of folderEntries) {
    entry.checkbox.disabled = !enabled || allFoldersToggle.checked;
  }
}

function renderBookmarkFolders(nodes) {
  const folders = collectBookmarkFolders(nodes);
  folderEntries = folders.map((folder) => {
    const label = document.createElement("label");
    label.className = "folder-option";
    label.style.setProperty("--folder-depth", String(folder.depth));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = favoriteFolderIds === null || favoriteFolderIds.includes(folder.id);
    const title = document.createElement("span");
    title.textContent = folder.title;
    label.append(checkbox, title);
    return { ...folder, checkbox, label };
  });
  folderList.replaceChildren(...folderEntries.map((entry) => entry.label));

  for (const entry of folderEntries) {
    entry.checkbox.addEventListener("change", async () => {
      for (const descendant of folderEntries) {
        if (descendant.ancestors.includes(entry.id)) {
          descendant.checkbox.checked = entry.checkbox.checked;
        }
      }
      favoriteFolderIds = folderEntries
        .filter((candidate) => candidate.checkbox.checked)
        .map((candidate) => candidate.id);
      await chrome.storage.sync.set({ favoriteFolderIds });
      showResultsStatus();
    });
  }
  updateFolderAvailability();
}

async function loadBookmarkFolders() {
  if (!chrome.bookmarks) {
    folderList.textContent = "Reload the extension and approve bookmark access to choose folders.";
    folderOptions.classList.add("disabled");
    return;
  }
  renderBookmarkFolders(await chrome.bookmarks.getTree());
}

async function refreshBlurToggle(storedValue) {
  const allowed = await chrome.permissions.contains(BLUR_PERMISSION);
  blurToggle.checked = Boolean(storedValue && allowed);
}

function renderCommandAssignments(container, definitions, commandsByName, expectedShortcut = null) {
  container.replaceChildren(...Object.entries(definitions).map(([name, label]) => {
    const command = commandsByName.get(name);
    const row = document.createElement("div");
    row.className = "command-assignment";
    const commandLabel = document.createElement("span");
    commandLabel.textContent = label;
    const shortcut = document.createElement("kbd");
    const expected = expectedShortcut?.(name);
    shortcut.textContent = command?.shortcut || (expected ? `Assign ${expected}` : "Unassigned");
    shortcut.classList.toggle("unassigned", !command?.shortcut);
    shortcut.classList.toggle("mismatched", Boolean(command?.shortcut && expected && !matchesExpectedShortcut(command.shortcut, expected)));
    if (command?.shortcut && expected && !matchesExpectedShortcut(command.shortcut, expected)) {
      shortcut.title = `Karabiner expects ${expected}`;
    }
    row.append(commandLabel, shortcut);
    return row;
  }));
}

function matchesExpectedShortcut(actual, expected) {
  return actual === expected;
}

function setKarabinerImportLink(link, url, enabled = true) {
  if (enabled) {
    link.href = `karabiner://karabiner/assets/complex_modifications/import?url=${encodeURIComponent(url)}`;
    link.classList.remove("disabled");
    link.setAttribute("aria-disabled", "false");
    link.removeAttribute("title");
  } else {
    link.removeAttribute("href");
    link.classList.add("disabled");
    link.setAttribute("aria-disabled", "true");
    link.title = "Assign the expected extension shortcuts first";
  }
}

async function refreshCommandAssignments() {
  refreshCommandsButton.disabled = true;
  try {
    const commands = await chrome.commands.getAll();
    const byName = new Map(commands.map((command) => [command.name, command]));
    renderCommandAssignments(commandAssignments, CORE_COMMANDS, byName, (name) => CORE_SHORTCUTS[name]);

    const coreReadyCount = Object.keys(CORE_COMMANDS).filter((name) => {
      const shortcut = byName.get(name)?.shortcut;
      return shortcut && shortcut === CORE_SHORTCUTS[name];
    }).length;
    const coreReady = coreReadyCount === Object.keys(CORE_COMMANDS).length;
    coreStatus.textContent = coreReady ? "Ready" : `${coreReadyCount} of 4 ready`;
    coreStatus.classList.toggle("ready", coreReady);
    coreStatus.classList.toggle("incomplete", !coreReady);
    coreSetupMessage.textContent = coreReady
      ? "All four bridge shortcuts match the core Karabiner mappings."
      : "Assign the expected shortcuts shown above before importing the core Karabiner rules. Existing custom assignments are not overwritten.";
    setKarabinerImportLink(importCoreKarabinerLink, CORE_KARABINER_RULE_URL, coreReady);
  } catch (error) {
    const message = error.message || "Could not read extension shortcuts.";
    commandAssignments.textContent = message;
    coreStatus.textContent = "Unavailable";
    setKarabinerImportLink(importCoreKarabinerLink, CORE_KARABINER_RULE_URL, false);
  } finally {
    refreshCommandsButton.disabled = false;
  }
}

const stored = await chrome.storage.sync.get({
  defaultSplitMode: DEFAULT_MODE,
  commandBarColor: DEFAULT_COMMAND_BAR_COLOR,
  blurInactiveSplitPane: false,
  closeDuplicateTabsOnActivation: false,
  showFavorites: true,
  showRecentlyClosed: true,
  favoriteFolderIds: null,
  resultSectionOrder: DEFAULT_RESULT_SECTION_ORDER,
  arcSetupCompleted: []
});
selectMode(stored.defaultSplitMode);
renderResultSectionOrder(stored.resultSectionOrder);
updateArcSetup(stored.arcSetupCompleted);
setThemeColor(stored.commandBarColor);
favoritesToggle.checked = stored.showFavorites !== false;
recentlyClosedToggle.checked = stored.showRecentlyClosed !== false;
duplicateTabsToggle.checked = stored.closeDuplicateTabsOnActivation === true;
favoriteFolderIds = Array.isArray(stored.favoriteFolderIds)
  ? stored.favoriteFolderIds
  : null;
allFoldersToggle.checked = favoriteFolderIds === null;
await Promise.all([
  refreshBlurToggle(stored.blurInactiveSplitPane),
  loadBookmarkFolders(),
  refreshCommandAssignments()
]);

refreshCommandsButton.addEventListener("click", () => void refreshCommandAssignments());
openExtensionShortcutsButton.addEventListener("click", () => {
  void chrome.tabs.create({ url: "helium://extensions/shortcuts" });
});
for (const button of heliumSettingButtons) {
  button.addEventListener("click", () => {
    void chrome.tabs.create({ url: button.dataset.settingsUrl });
  });
}
for (const checkbox of arcSetupCheckboxes) {
  checkbox.addEventListener("change", async () => {
    const arcSetupCompleted = collectCompletedSetupSteps();
    updateArcSetup(arcSetupCompleted);
    await chrome.storage.sync.set({ arcSetupCompleted });
  });
}

themeColorInput.addEventListener("input", () => setThemeColor(themeColorInput.value));
themeColorInput.addEventListener("change", () => void saveThemeColor(themeColorInput.value));
themeColorText.addEventListener("change", () => void saveThemeColor(themeColorText.value));
themeColorText.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveThemeColor(themeColorText.value);
  }
});
for (const preset of themePresets) {
  preset.addEventListener("click", () => void saveThemeColor(preset.dataset.color));
}

for (const choice of choices) {
  choice.addEventListener("change", async () => {
    if (!choice.checked) return;
    await chrome.storage.sync.set({ defaultSplitMode: choice.value });
    showSaved();
  });
}

favoritesToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ showFavorites: favoritesToggle.checked });
  updateFolderAvailability();
  showResultsStatus();
});

recentlyClosedToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ showRecentlyClosed: recentlyClosedToggle.checked });
  showResultsStatus();
});

duplicateTabsToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    closeDuplicateTabsOnActivation: duplicateTabsToggle.checked
  });
  showDuplicatesStatus();
});

allFoldersToggle.addEventListener("change", async () => {
  if (allFoldersToggle.checked) {
    favoriteFolderIds = null;
    for (const entry of folderEntries) entry.checkbox.checked = true;
  } else {
    favoriteFolderIds = folderEntries.map((entry) => entry.id);
  }
  await chrome.storage.sync.set({ favoriteFolderIds });
  updateFolderAvailability();
  showResultsStatus();
});

if (chrome.bookmarks) {
  for (const event of [
    chrome.bookmarks.onCreated,
    chrome.bookmarks.onRemoved,
    chrome.bookmarks.onChanged,
    chrome.bookmarks.onMoved,
    chrome.bookmarks.onChildrenReordered,
    chrome.bookmarks.onImportEnded
  ].filter(Boolean)) {
    event.addListener(() => void loadBookmarkFolders());
  }
}

blurToggle.addEventListener("change", async () => {
  blurToggle.disabled = true;
  try {
    if (blurToggle.checked) {
      const granted = await chrome.permissions.request(BLUR_PERMISSION);
      if (!granted) {
        blurToggle.checked = false;
        showBlurStatus("Permission not granted", true);
        return;
      }
      await chrome.storage.sync.set({ blurInactiveSplitPane: true });
      showBlurStatus("Enabled");
    } else {
      await chrome.storage.sync.set({ blurInactiveSplitPane: false });
      await chrome.permissions.remove(BLUR_PERMISSION);
      showBlurStatus("Disabled");
    }
  } catch (error) {
    blurToggle.checked = false;
    showBlurStatus(error.message || "Could not change permission", true);
  } finally {
    blurToggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (changes.commandBarColor) setThemeColor(changes.commandBarColor.newValue);
  if (changes.defaultSplitMode) selectMode(changes.defaultSplitMode.newValue);
  if (changes.showFavorites) {
    favoritesToggle.checked = changes.showFavorites.newValue !== false;
    updateFolderAvailability();
  }
  if (changes.showRecentlyClosed) {
    recentlyClosedToggle.checked = changes.showRecentlyClosed.newValue !== false;
  }
  if (changes.closeDuplicateTabsOnActivation) {
    duplicateTabsToggle.checked = changes.closeDuplicateTabsOnActivation.newValue === true;
  }
  if (changes.arcSetupCompleted) {
    updateArcSetup(changes.arcSetupCompleted.newValue);
  }
  if (changes.resultSectionOrder) {
    renderResultSectionOrder(changes.resultSectionOrder.newValue);
  }
  if (changes.favoriteFolderIds) {
    favoriteFolderIds = Array.isArray(changes.favoriteFolderIds.newValue)
      ? changes.favoriteFolderIds.newValue
      : null;
    allFoldersToggle.checked = favoriteFolderIds === null;
    for (const entry of folderEntries) {
      entry.checkbox.checked = favoriteFolderIds === null || favoriteFolderIds.includes(entry.id);
    }
    updateFolderAvailability();
  }
  if (changes.blurInactiveSplitPane) {
    void refreshBlurToggle(changes.blurInactiveSplitPane.newValue);
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions.origins?.some((origin) => origin === "<all_urls>" || origin === "*://*/*")) {
    blurToggle.checked = false;
  }
});
