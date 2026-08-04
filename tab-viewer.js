(() => {
  if (globalThis.__heliumCommandBarTabViewerInstalled) return;
  globalThis.__heliumCommandBarTabViewerInstalled = true;

  const ROOT_ID = `helium-tab-viewer-${chrome.runtime.id}`;
  let root = null;
  let shadow = null;
  let currentSessionId = null;
  let livenessTimer = null;
  let releaseCommitTimer = null;
  let waitingForShiftRelease = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function favicon(tab) {
    const box = element("span", "favicon-box");
    const fallback = element(
      "span",
      "favicon-fallback",
      (tab.title || "T").trim().charAt(0).toLocaleUpperCase(),
    );
    box.append(fallback);

    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      const image = element("img", "favicon");
      image.src = tab.favIconUrl;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => fallback.remove());
      image.addEventListener("error", () => image.remove());
      box.append(image);
    }
    return box;
  }

  function cancelPendingReleaseCommit() {
    clearTimeout(releaseCommitTimer);
    releaseCommitTimer = null;
  }

  function scheduleReleaseCommit() {
    cancelPendingReleaseCommit();
    releaseCommitTimer = setTimeout(() => {
      releaseCommitTimer = null;
      send("helium-tab-viewer:commit");
    }, 120);
  }

  function removeViewer() {
    clearInterval(livenessTimer);
    cancelPendingReleaseCommit();
    root?.remove();
    root = null;
    shadow = null;
    currentSessionId = null;
    livenessTimer = null;
    waitingForShiftRelease = false;
  }

  function startLivenessCheck() {
    if (livenessTimer) return;
    livenessTimer = setInterval(() => {
      try {
        void chrome.runtime.sendMessage({
          type: "helium-tab-viewer:heartbeat",
          sessionId: currentSessionId,
        }).catch(removeViewer);
      } catch {
        removeViewer();
      }
    }, 15000);
  }

  function send(type, details = {}) {
    if (!currentSessionId) return;
    void chrome.runtime.sendMessage({
      type,
      sessionId: currentSessionId,
      ...details,
    }).catch(() => {});
  }

  function ensureViewer() {
    if (root?.isConnected) return;

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.cssText = [
      "all: initial !important",
      "position: fixed !important",
      "inset: 0 !important",
      "z-index: 2147483647 !important",
      "display: block !important",
    ].join(";");
    document.documentElement.append(root);
    shadow = root.attachShadow({ mode: "closed" });

    const style = element("style");
    style.textContent = `
      :host {
        color-scheme: light dark;
        --bg: #f7f6f9;
        --surface: rgba(255, 255, 255, .82);
        --surface-strong: #fff;
        --text: #242229;
        --muted: #77727f;
        --border: rgba(42, 35, 51, .12);
        --theme-accent: #505156;
        --accent: var(--theme-accent);
        --selected: color-mix(in srgb, var(--theme-accent) 13%, var(--surface-strong));
        --selected-border: color-mix(in srgb, var(--theme-accent) 30%, transparent);
        --shadow: 0 24px 80px rgba(29, 24, 36, .28);
      }
      * { box-sizing: border-box; }
      .backdrop {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(12, 10, 16, .18);
        backdrop-filter: blur(2px);
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .viewer {
        width: min(620px, calc(100vw - 32px));
        max-height: min(580px, calc(100vh - 40px));
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 15px;
        outline: none;
        background:
          radial-gradient(circle at 10% -20%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 42%),
          var(--bg);
        color: var(--text);
        box-shadow: var(--shadow);
      }
      header {
        padding: 14px 19px 5px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 650;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .list {
        display: flex;
        max-height: min(500px, calc(100vh - 115px));
        padding: 0 8px 8px;
        overflow-y: scroll;
        overscroll-behavior: contain;
        flex-direction: column;
        scrollbar-gutter: stable;
      }
      .row {
        display: flex;
        width: 100%;
        min-height: 54px;
        align-items: center;
        gap: 11px;
        padding: 7px 10px;
        border: 1px solid transparent;
        border-radius: 10px;
        outline: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: default;
        user-select: none;
      }
      .row.selected {
        border-color: var(--selected-border);
        background: var(--selected);
      }
      .row:hover:not(.selected) {
        background: color-mix(in srgb, var(--accent) 7%, transparent);
      }
      .favicon-box {
        position: relative;
        display: grid;
        width: 30px;
        height: 30px;
        flex: none;
        place-items: center;
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface-strong);
      }
      .favicon, .favicon-fallback { grid-area: 1 / 1; }
      .favicon { width: 18px; height: 18px; object-fit: contain; }
      .favicon-fallback {
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
      }
      .details { display: flex; min-width: 0; flex: 1; flex-direction: column; }
      .title, .subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .title { font-weight: 650; }
      .subtitle { color: var(--muted); font-size: 11px; }
      .split-row { min-height: 58px; gap: 8px; padding: 5px 7px; }
      .split-members {
        display: grid;
        min-width: 0;
        flex: 1;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      .split-member {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        padding: 3px 9px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
      }
      .split-member.focused {
        border-color: var(--selected-border);
        background: var(--surface-strong);
      }
      .split-member .favicon-box { width: 24px; height: 24px; border-radius: 6px; }
      .split-member .favicon { width: 15px; height: 15px; }
      .split-member .favicon-fallback { font-size: 10px; }
      .split-member-title {
        min-width: 0;
        overflow: hidden;
        font-size: 11px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --bg: #1f1d22;
          --surface: rgba(46, 43, 50, .84);
          --surface-strong: #312e35;
          --text: #f3f0f5;
          --muted: #aaa4b0;
          --border: rgba(255, 255, 255, .1);
          --accent: color-mix(in srgb, var(--theme-accent) 44%, white);
          --selected: color-mix(in srgb, var(--theme-accent) 28%, var(--surface-strong));
          --selected-border: color-mix(in srgb, var(--theme-accent) 42%, transparent);
          --shadow: 0 24px 80px rgba(0, 0, 0, .42);
        }
      }
    `;

    const backdrop = element("div", "backdrop");
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) send("helium-tab-viewer:cancel");
    });
    shadow.append(style, backdrop);
  }

  function render(message) {
    currentSessionId = message.sessionId;
    cancelPendingReleaseCommit();
    waitingForShiftRelease = false;
    startLivenessCheck();
    ensureViewer();
    if (/^#[0-9a-f]{6}$/i.test(message.accentColor || "")) {
      root.style.setProperty("--theme-accent", message.accentColor);
    }
    const backdrop = shadow.querySelector(".backdrop");
    let viewer = backdrop.querySelector(".viewer");
    const openTabCount = message.items.reduce(
      (count, item) => count + item.members.length,
      0,
    );
    let list;
    let header;
    const isNewViewer = !viewer;

    if (isNewViewer) {
      viewer = element("section", "viewer");
      viewer.tabIndex = -1;
      viewer.setAttribute("aria-label", "Open tabs");

      header = element("header");
      list = element("div", "list");

      viewer.append(header, list);
      backdrop.append(viewer);
    } else {
      header = viewer.querySelector("header");
      list = viewer.querySelector(".list");
    }
    header.textContent = `${openTabCount} OPEN TABS`;

    const existingRows = [...list.querySelectorAll(":scope > .row")];
    const canReuseRows = existingRows.length === message.items.length &&
      existingRows.every((row, index) => row.dataset.blockKey === message.items[index].key);
    if (canReuseRows) {
      existingRows.forEach((row, index) => {
        const selected = index === message.selectedIndex;
        row.classList.toggle("selected", selected);
        row.setAttribute("aria-current", String(selected));
      });
    } else {
      const rows = message.items.map((item, index) => {
        const row = element(
          "button",
          `row${index === message.selectedIndex ? " selected" : ""}`,
        );
        row.type = "button";
        row.dataset.blockKey = item.key;
        row.setAttribute("aria-current", String(index === message.selectedIndex));
        row.addEventListener("click", () => {
          send("helium-tab-viewer:select", { blockKey: item.key });
        });
        row.addEventListener("mouseenter", () => {
          for (const candidate of list.querySelectorAll(":scope > .row")) {
            const selected = candidate === row;
            candidate.classList.toggle("selected", selected);
            candidate.setAttribute("aria-current", String(selected));
          }
          send("helium-tab-viewer:hover", { blockKey: item.key });
        });

        if (item.type === "split") {
          row.classList.add("split-row");
          const members = element("span", "split-members");
          for (const member of item.members) {
            const memberElement = element(
              "span",
              `split-member${member.id === item.targetTabId ? " focused" : ""}`,
            );
            memberElement.append(
              favicon(member),
              element("span", "split-member-title", member.title || "Untitled tab"),
            );
            members.append(memberElement);
          }
          row.append(members);
        } else {
          const tab = item.members[0];
          const details = element("span", "details");
          details.append(
            element("span", "title", tab.title || "Untitled tab"),
            element("span", "subtitle", tab.subtitle || ""),
          );
          row.append(favicon(tab), details);
        }
        return row;
      });
      list.replaceChildren(...rows);
    }
    list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });

    if (isNewViewer) {
      const focusViewer = () => {
        if (!root?.isConnected) return;
        window.focus();
        viewer.focus({ preventScroll: true });
      };
      focusViewer();
      for (const delay of [0, 50, 150]) setTimeout(focusViewer, delay);
    } else if (shadow.activeElement !== viewer) {
      viewer.focus({ preventScroll: true });
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "helium-tab-viewer:show") render(message);
    if (
      message?.type === "helium-tab-viewer:hide" &&
      (!message.sessionId || message.sessionId === currentSessionId)
    ) {
      removeViewer();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (!root?.isConnected) return;
    if (event.key === "Control") {
      // Karabiner may briefly release its synthetic Control modifier while
      // translating Ctrl-Shift-Tab. Defer the commit so an immediately
      // following Shift event or navigation update can cancel it.
      if (event.shiftKey) {
        waitingForShiftRelease = true;
      } else {
        scheduleReleaseCommit();
      }
    } else if (event.key === "Shift" && waitingForShiftRelease) {
      waitingForShiftRelease = false;
      if (!event.ctrlKey) scheduleReleaseCommit();
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!root?.isConnected) return;
    if (event.key === "Shift" || event.ctrlKey) {
      cancelPendingReleaseCommit();
    }
    const closesSelection =
      event.key === "Delete" ||
      event.key === "Backspace" ||
      (event.key.toLocaleLowerCase() === "d" && !event.metaKey && !event.altKey);
    if (closesSelection) {
      event.preventDefault();
      event.stopImmediatePropagation();
      send("helium-tab-viewer:close-selected", {
        blockKey: shadow.querySelector(".row.selected")?.dataset.blockKey,
      });
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      send("helium-tab-viewer:cancel");
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      send("helium-tab-viewer:commit");
    }
  }, true);
})();
