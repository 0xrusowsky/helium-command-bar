const DEFAULT_MODE = "compact";
const VALID_MODES = new Set(["compact", "expanded"]);
const status = document.querySelector("#save-status");
const blurStatus = document.querySelector("#blur-status");
const blurToggle = document.querySelector("#blur-inactive-split");
const choices = [...document.querySelectorAll('input[name="defaultSplitMode"]')];
const BLUR_PERMISSION = { origins: ["<all_urls>"] };
let statusTimer;
let blurStatusTimer;

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

async function refreshBlurToggle(storedValue) {
  const allowed = await chrome.permissions.contains(BLUR_PERMISSION);
  blurToggle.checked = Boolean(storedValue && allowed);
}

const stored = await chrome.storage.sync.get({
  defaultSplitMode: DEFAULT_MODE,
  blurInactiveSplitPane: false
});
selectMode(stored.defaultSplitMode);
await refreshBlurToggle(stored.blurInactiveSplitPane);

for (const choice of choices) {
  choice.addEventListener("change", async () => {
    if (!choice.checked) return;
    await chrome.storage.sync.set({ defaultSplitMode: choice.value });
    showSaved();
  });
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
  if (changes.defaultSplitMode) selectMode(changes.defaultSplitMode.newValue);
  if (changes.blurInactiveSplitPane) {
    void refreshBlurToggle(changes.blurInactiveSplitPane.newValue);
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions.origins?.some((origin) => origin === "<all_urls>" || origin === "*://*/*")) {
    blurToggle.checked = false;
  }
});
