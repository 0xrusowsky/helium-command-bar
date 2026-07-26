(() => {
  const rootId = `helium-command-bar-inactive-blur-${chrome.runtime.id}`;
  if (document.getElementById(rootId)) return;

  const root = document.createElement("div");
  root.id = rootId;
  root.setAttribute("aria-hidden", "true");

  function applyMode(mode) {
    const blur = mode === "blur";
    root.dataset.mode = mode;
    root.style.cssText = [
      "all: initial !important",
      "position: fixed !important",
      "inset: 0 !important",
      "z-index: 2147483646 !important",
      "display: block !important",
      "pointer-events: none !important",
      `background: rgba(12, 10, 16, ${blur ? "0.12" : "0.075"}) !important`,
      `backdrop-filter: ${blur ? "blur(3px)" : "none"} !important`,
      `-webkit-backdrop-filter: ${blur ? "blur(3px)" : "none"} !important`,
      "transition: background 140ms ease, backdrop-filter 140ms ease !important"
    ].join(";");
  }

  function cleanup() {
    root.remove();
    chrome.runtime.onMessage.removeListener(handleMessage);
    chrome.storage.onChanged.removeListener(removeWhenDisabled);
  }

  function handleMessage(message, _sender, sendResponse) {
    if (message?.type === "helium-command-bar:set-inactive-effect") {
      if (message.mode === "dim" || message.mode === "blur") applyMode(message.mode);
      else cleanup();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "helium-command-bar:remove-inactive-blur") {
      cleanup();
      sendResponse({ ok: true });
    }
  }

  function removeWhenDisabled(changes, areaName) {
    if (areaName === "sync" && changes.blurInactiveSplitPane?.newValue === false) cleanup();
  }

  applyMode("dim");
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.storage.onChanged.addListener(removeWhenDisabled);
  document.documentElement.append(root);
})();
