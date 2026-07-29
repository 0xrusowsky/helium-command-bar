const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_STATE_KEY = "extensionUpdateState";

export function compareVersions(left, right) {
  const leftParts = String(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export async function getExtensionUpdateState() {
  const stored = await chrome.storage.local.get(UPDATE_STATE_KEY);
  return stored[UPDATE_STATE_KEY] ?? null;
}

export async function checkForExtensionUpdate({ force = false } = {}) {
  const currentVersion = chrome.runtime.getManifest().version;
  const previous = await getExtensionUpdateState();
  if (!force && previous?.checkedAt > Date.now() - CHECK_INTERVAL_MS) {
    return previous;
  }

  try {
    const manifestUrl = new URL(chrome.runtime.getURL("manifest.json"));
    manifestUrl.searchParams.set("update-check", String(Date.now()));
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    const diskVersion = (await response.json()).version;
    const state = {
      checkedAt: Date.now(),
      currentVersion,
      availableVersion: diskVersion,
      updateAvailable: compareVersions(diskVersion, currentVersion) > 0,
    };
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
    return state;
  } catch (error) {
    // Record the attempt so a failing check does not run on every shortcut.
    const state = { ...previous, checkedAt: Date.now(), currentVersion };
    await chrome.storage.local.set({ [UPDATE_STATE_KEY]: state });
    console.info("Could not check for an extension update", error);
    return state;
  }
}
