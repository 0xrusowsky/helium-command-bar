const DEFAULT_MODE = "compact";
const VALID_MODES = new Set(["compact", "expanded"]);
const status = document.querySelector("#save-status");
const choices = [...document.querySelectorAll('input[name="defaultSplitMode"]')];
let statusTimer;

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

const stored = await chrome.storage.sync.get({ defaultSplitMode: DEFAULT_MODE });
selectMode(stored.defaultSplitMode);

for (const choice of choices) {
  choice.addEventListener("change", async () => {
    if (!choice.checked) return;
    await chrome.storage.sync.set({ defaultSplitMode: choice.value });
    showSaved();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.defaultSplitMode) {
    selectMode(changes.defaultSplitMode.newValue);
  }
});
