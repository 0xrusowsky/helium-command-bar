(async () => {
  const rootId = `helium-command-bar-${chrome.runtime.id}`;
  const existing = document.getElementById(rootId);
  if (existing) {
    existing.dispatchEvent(new CustomEvent("helium-command-bar:request-close"));
    return;
  }

  const root = document.createElement("div");
  root.id = rootId;
  root.style.cssText = [
    "all: initial !important",
    "position: fixed !important",
    "inset: 0 !important",
    "z-index: 2147483647 !important",
    "display: block !important"
  ].join(";");
  document.documentElement.append(root);

  let initial;
  try {
    initial = await chrome.runtime.sendMessage({
      type: "helium-command-bar:query",
      query: ""
    });
  } catch (error) {
    console.error("Could not open Helium Command Bar", error);
    root.remove();
    return;
  }
  if (!root.isConnected || !initial) return;

  const shadow = root.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = initial.css;

  const backdrop = document.createElement("div");
  Object.assign(backdrop.style, {
    all: "initial",
    position: "absolute",
    inset: "0",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
    padding: "20px",
    background: "rgba(12, 10, 16, 0.18)",
    backdropFilter: "blur(2px)"
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgIcon(pathData, className = "row-icon") {
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

  const commandBar = element("section", "command-bar");
  commandBar.setAttribute("aria-label", "Helium Command Bar");

  const searchBox = element("div", "search-box");
  searchBox.append(svgIcon(
    "m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
    "search-icon"
  ));

  const queryInput = element("input");
  queryInput.id = "query";
  queryInput.type = "text";
  queryInput.autocomplete = "off";
  queryInput.autocapitalize = "off";
  queryInput.spellcheck = false;
  queryInput.placeholder = "Search open/closed tabs or enter a URL…";
  queryInput.setAttribute("aria-controls", "results");
  queryInput.setAttribute("aria-autocomplete", "list");

  const escapeHint = element("kbd", "", "esc");
  escapeHint.id = "escape-hint";
  searchBox.append(queryInput, escapeHint);

  const resultLabel = element("div", "visually-hidden", initial.label);
  resultLabel.id = "result-label";
  resultLabel.setAttribute("role", "status");
  resultLabel.setAttribute("aria-live", "polite");
  const emptyElement = element("div", "empty", "No open or recently closed tabs found");
  emptyElement.id = "empty";
  emptyElement.hidden = true;
  const resultsElement = element("div");
  resultsElement.id = "results";
  resultsElement.setAttribute("role", "listbox");
  resultsElement.setAttribute("aria-label", "Command results");

  const footer = element("footer");
  const selectHelp = element("span");
  selectHelp.append(element("kbd", "", "↑"), element("kbd", "", "↓"), document.createTextNode(" select"));
  const openHelp = element("span");
  openHelp.append(element("kbd", "", "↵"), document.createTextNode(" open"));
  const closeHelp = element("span");
  closeHelp.append(element("kbd", "", "⌘⌫"), document.createTextNode(" close tab"));
  footer.append(selectHelp, openHelp, closeHelp);

  commandBar.append(searchBox, resultLabel, emptyElement, resultsElement, footer);
  backdrop.append(commandBar);
  shadow.append(style, backdrop);

  // Keep command-bar keystrokes and clicks from reaching page-level bubble
  // listeners. The UI itself remains in an isolated JavaScript world.
  for (const eventName of ["keydown", "keyup", "keypress", "input", "click", "mousedown", "mouseup"])
    commandBar.addEventListener(eventName, (event) => event.stopPropagation());

  let rows = initial.rows;
  let sectionOrder = initial.sectionOrder || ["open", "favorites", "closed"];
  let navigationItems = [];
  let selectedIndex = 0;
  let queryGeneration = 0;
  let defaultSplitExpanded = Boolean(initial.defaultSplitExpanded);
  const splitNavigationKeys = new Set();
  const expandedSettingIds = new Set();

  function isSplitVisuallyExpanded(splitKey) {
    return defaultSplitExpanded || splitNavigationKeys.has(splitKey);
  }

  function focusCommandBar() {
    if (!root.isConnected) return;
    // Browser-owned controls such as the find bar can retain the native Views
    // focus even after a renderer input becomes document.activeElement.
    // Request both window and element focus, then retry after the command event
    // and asynchronous overlay setup have finished.
    window.focus();
    queryInput.focus({ preventScroll: true });
  }

  function closeCommandBar() {
    // Always dismiss the injected DOM before touching extension APIs. A reload
    // invalidates the content-script context but leaves its DOM behind.
    root.remove();
    try {
      void chrome.runtime.sendMessage({
        type: "helium-command-bar:close-overlay",
        blurredPartnerIds: initial.blurredPartnerIds || []
      }).catch(() => {});
    } catch {
      // The extension may already have reloaded.
    }
  }

  function reloadExtension() {
    // chrome.runtime.reload() destroys this script's extension context before
    // a response can close the overlay, so remove it first.
    root.remove();
    try {
      void chrome.runtime.sendMessage({
        type: "helium-command-bar:reload-extension",
        blurredPartnerIds: initial.blurredPartnerIds || []
      }).catch(() => {});
    } catch {
      // The extension may already be reloading.
    }
  }

  root.addEventListener("helium-command-bar:request-close", closeCommandBar, { once: true });

  function hostnameFor(item) {
    const value = item.url || item.pendingUrl || "";
    try {
      const url = new URL(value);
      return url.hostname || url.protocol.replace(":", "");
    } catch {
      return value;
    }
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

  function makeFaviconBox(item, extraClass = "") {
    const iconBox = element("span", `favicon-box ${extraClass}`.trim());
    const fallback = element(
      "span",
      "favicon-fallback",
      (item.title || hostnameFor(item) || "T").trim().charAt(0).toLocaleUpperCase()
    );
    iconBox.append(fallback);

    if (item.favIconUrl && !item.favIconUrl.startsWith("chrome://")) {
      const favicon = element("img", "favicon");
      favicon.src = item.favIconUrl;
      favicon.alt = "";
      favicon.referrerPolicy = "no-referrer";
      favicon.addEventListener("load", () => fallback.remove());
      favicon.addEventListener("error", () => favicon.remove());
      iconBox.append(favicon);
    }
    return iconBox;
  }

  function makeTabRow(row, index) {
    const { tab } = row;
    const rowElement = element(
      "li",
      `result-row tab-row${row.kind === "split-member" ? " split-member-row" : ""}`
    );
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const details = element("span", "result-details");
    details.append(
      element("span", "result-title", tab.title || "Untitled tab"),
      element("span", "result-subtitle", hostnameFor(tab))
    );

    const trailing = element("span", "row-trailing");
    if (tab.active) trailing.append(element("span", "current-pill", "Active"));
    if (tab.bookmarkId) {
      const favorite = element("span", "favorite-tab-indicator");
      favorite.title = "Favorite";
      favorite.setAttribute("aria-label", "Favorite");
      favorite.append(svgIcon(
        "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z",
        "favorite-tab-icon"
      ));
      trailing.append(favorite);
    }
    if (tab.pinned) {
      const pinned = element("span", "pinned-tab-indicator");
      pinned.title = "Pinned tab";
      pinned.setAttribute("aria-label", "Pinned tab");
      pinned.append(svgIcon(
        "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h7v7h2v-7h7v-2c-1.66 0-3-1.34-3-3Z",
        "pinned-tab-icon"
      ));
      trailing.append(pinned);
    }

    const closeButton = element("button", "close-tab", "×");
    closeButton.type = "button";
    closeButton.title = "Close tab";
    closeButton.setAttribute("aria-label", `Close ${tab.title || "tab"}`);
    closeButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await closeTab(tab.id);
    });
    trailing.append(closeButton, element("kbd", "tab-enter-hint", "↵"));
    rowElement.append(makeFaviconBox(tab), details, trailing);
    return rowElement;
  }

  function splitRepresentative(memberRows) {
    return memberRows.find((row) => row.tab.active)?.tab ||
      [...memberRows].sort((left, right) => (right.tab.lastAccessed || 0) - (left.tab.lastAccessed || 0))[0]?.tab;
  }

  function makeSplitGroup(size, navigationEntered, label = "Split view") {
    const group = element(
      "li",
      `split-group expanded${navigationEntered ? " navigation-entered" : ""}`
    );
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${label} with ${size} options`);

    const header = element("div", "split-group-header");
    header.append(
      svgIcon(
        "M4 5.5h7v13H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Zm9 0h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v-13Z",
        "split-group-icon"
      ),
      document.createTextNode(label),
      element("kbd", "split-navigation-hint", navigationEntered ? "←" : "→")
    );

    const entries = element("ul", "split-group-entries");
    entries.setAttribute("role", "presentation");
    group.append(header, entries);
    return { group, entries };
  }

  function makeCompactFavicon(tab) {
    const iconBox = element("span", "compact-favicon-box");
    const fallback = element(
      "span",
      "",
      (tab.title || hostnameFor(tab) || "T").trim().charAt(0).toLocaleUpperCase()
    );
    iconBox.append(fallback);

    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      const favicon = element("img");
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
    const group = element("li", "split-group collapsed");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `Split view with ${memberRows.length} tabs`);

    const option = element("div", "result-row split-collapsed-row");
    option.id = `result-${index}`;
    option.setAttribute("role", "option");

    const columns = element("span", "split-columns");
    memberRows.forEach((memberRow) => {
      const { tab } = memberRow;
      const column = element("button", "split-column");
      column.type = "button";
      column.title = `Open split and focus ${tab.title || "tab"}`;
      const details = element("span", "split-column-details");
      details.append(
        element("span", "split-column-title", tab.title || "Untitled tab"),
        element("span", "split-column-subtitle", hostnameFor(tab))
      );
      column.append(makeCompactFavicon(tab), details);
      if (tab.bookmarkId) {
        const favorite = element("span", "favorite-tab-indicator");
        favorite.title = "Favorite";
        favorite.append(svgIcon(
          "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z",
          "favorite-tab-icon"
        ));
        column.append(favorite);
      }
      if (tab.pinned) {
        const pinned = element("span", "pinned-tab-indicator");
        pinned.title = "Pinned tab";
        pinned.append(svgIcon(
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

    const hint = element("kbd", "split-navigation-hint", "→");
    hint.title = "Enter split navigation";
    option.append(columns, hint);
    group.append(option);
    return { group, option };
  }

  function makeBookmarkRow(row, index) {
    const { bookmark } = row;
    const rowElement = element("li", "result-row bookmark-row");
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const iconBox = makeFaviconBox(bookmark, "favorite-favicon-box");
    const location = hostnameFor(bookmark);
    const details = element("span", "result-details");
    details.append(
      element("span", "result-title", bookmark.title || "Untitled bookmark"),
      element(
        "span",
        "result-subtitle",
        bookmark.folder ? `${location} · ${bookmark.folder}` : location
      )
    );
    rowElement.append(iconBox, details, element("kbd", "enter-hint", "↵"));
    return rowElement;
  }

  function makeClosedRow(row, index) {
    const { closed } = row;
    const rowElement = element("li", "result-row recently-closed-row");
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const details = element("span", "result-details");
    const location = hostnameFor(closed);
    const closedType = closed.isWindow
      ? `${closed.tabCount} tabs · Recently closed window`
      : "Recently closed";
    details.append(
      element("span", "result-title", closed.title),
      element("span", "result-subtitle", location ? `${location} · ${closedType}` : closedType)
    );

    const restore = element("span", "restore-pill");
    restore.append(
      svgIcon("M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5", "restore-icon"),
      document.createTextNode("Restore")
    );
    rowElement.append(makeFaviconBox(closed, "closed-favicon-box"), details, restore);
    return rowElement;
  }

  function makeTabActionRow(row, index) {
    const { action } = row;
    const rowElement = element("li", "result-row tab-action-row");
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const iconBox = element("span", `tab-action-icon-box ${action.icon}`);
    iconBox.append(svgIcon(
      action.icon === "favorite"
        ? "m12 3 2.8 5.67 6.26.91-4.53 4.42 1.07 6.24L12 18.1 6.4 21l1.07-6.24-4.53-4.42 6.26-.91L12 3Z"
        : "M16 9V4l1-1V2H7v1l1 1v5c0 1.66-1.34 3-3 3v2h7v7h2v-7h7v-2c-1.66 0-3-1.34-3-3Z",
      action.icon === "favorite" ? "favorite-action-icon" : "pin-action-icon"
    ));

    const details = element("span", "result-details");
    details.append(
      element("span", "result-title", action.title),
      element("span", "result-subtitle", action.description)
    );
    rowElement.append(iconBox, details, element("kbd", "enter-hint", "↵"));
    return rowElement;
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
    const rowElement = element("li", "result-row setting-row");
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const iconBox = element("span", `setting-icon-box ${setting.icon || "settings"}`);
    iconBox.append(svgIcon(settingIconPath(setting), "setting-icon"));

    const details = element("span", "result-details");
    details.append(
      element("span", "result-title", setting.title),
      element(
        "span",
        "result-subtitle",
        row.tab ? `${setting.description} · Open tab` : `${setting.description} · Helium`
      )
    );
    rowElement.append(
      iconBox,
      details,
      element("kbd", "enter-hint", row.expandable ? "→" : "↵"),
    );
    return rowElement;
  }

  function makeLaunchRow(row, index) {
    const rowElement = element("li", "result-row launch-row");
    rowElement.id = `result-${index}`;
    rowElement.setAttribute("role", "option");

    const iconBox = element("span", "launch-icon-box");
    const isUrl = row.target.kind === "url";
    iconBox.append(svgIcon(
      isUrl
        ? "M14 5h5v5m0-5L10 14m7 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"
        : "m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
    ));

    const details = element("span", "result-details");
    details.append(
      element(
        "span",
        "result-title",
        isUrl ? `Open ${row.target.display}` : `Search for “${row.target.text}”`
      ),
      element(
        "span",
        "result-subtitle",
        isUrl ? "New tab" : "Default search engine · New tab"
      )
    );

    const isMac = navigator.userAgentData?.platform === "macOS" || /Mac/.test(navigator.platform);
    const enterHint = element("kbd", "enter-hint", isMac ? "⌘↵" : "Ctrl↵");
    enterHint.title = "Always open or search the input in a new tab";
    rowElement.append(iconBox, details, enterHint);
    return rowElement;
  }

  function bindNavigationItem(rowElement, item) {
    const index = navigationItems.length;
    const navigationItem = { ...item, element: rowElement };
    navigationItems.push(navigationItem);
    rowElement.id = `result-${index}`;
    rowElement.dataset.navigationIndex = String(index);
    rowElement.addEventListener("mousedown", (event) => event.preventDefault());
    rowElement.addEventListener("click", () => activateNavigationItem(index));
    rowElement.addEventListener("mouseenter", () => setSelected(index, { scroll: false }));
    return rowElement;
  }

  function makeResultSection(title) {
    const section = element("section", "result-section");
    const heading = element("div", "result-section-heading", title);
    const list = element("ul", "result-section-list");
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
              const rowElement = makeTabRow(memberRow, navigationItems.length);
              entries.append(bindNavigationItem(rowElement, { kind: "split-member", row: memberRow, splitKey, memberRows }));
            });
          } else {
            memberRows.forEach((memberRow) => {
              const rowElement = makeTabRow(memberRow, navigationItems.length);
              rowElement.removeAttribute("id");
              rowElement.setAttribute("role", "presentation");
              rowElement.addEventListener("mousedown", (event) => event.preventDefault());
              rowElement.addEventListener("click", async (event) => {
                event.stopPropagation();
                await activateTab(memberRow.tab);
              });
              entries.append(rowElement);
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

      let rowElement;
      if (row.kind === "tab") rowElement = makeTabRow(row, navigationItems.length);
      else if (row.kind === "bookmark") rowElement = makeBookmarkRow(row, navigationItems.length);
      else if (row.kind === "closed") rowElement = makeClosedRow(row, navigationItems.length);
      else if (row.kind === "setting" || row.kind === "extension-setting" || row.kind === "extension-update" || row.kind === "update") rowElement = makeSettingRow(row, navigationItems.length);
      else if (row.kind === "tab-action") rowElement = makeTabActionRow(row, navigationItems.length);
      else rowElement = makeLaunchRow(row, navigationItems.length);
      const section = row.kind === "launch" || row.kind === "setting" || row.kind === "extension-setting" || row.kind === "extension-update" || row.kind === "update" || row.kind === "tab-action"
        ? sections.search
        : row.kind === "bookmark"
          ? sections.favorites
          : row.kind === "closed" ? sections.closed : sections.open;
      section.list.append(bindNavigationItem(rowElement, { kind: "row", row }));
      rowIndex += 1;
    }

    for (const key of ["search", ...sectionOrder]) {
      const section = sections[key];
      if (section?.list.childElementCount > 0) fragment.append(section.section);
    }
    resultsElement.replaceChildren(fragment);
    emptyElement.hidden = rows.length !== 0;
    selectedIndex = Math.max(0, Math.min(selectedIndex, navigationItems.length - 1));
    setSelected(selectedIndex, { scroll: false });
    queryInput.focus({ preventScroll: true });
  }

  async function refreshRows({ resetSelection = false } = {}) {
    const generation = ++queryGeneration;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "helium-command-bar:query",
        query: queryInput.value
      });
      if (generation !== queryGeneration || !response) return;
      rows = response.rows;
      sectionOrder = response.sectionOrder || sectionOrder;
      resultLabel.textContent = response.label;
      defaultSplitExpanded = Boolean(response.defaultSplitExpanded);
      if (resetSelection) selectedIndex = 0;
      renderRows();
    } catch (error) {
      console.error("Could not refresh command bar", error);
    }
  }

  async function sendAction(message, { close = true } = {}) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (close && response?.ok) closeCommandBar();
      return response;
    } catch (error) {
      console.error("Command bar action failed", error);
      return undefined;
    }
  }

  async function activateTab(tab) {
    await sendAction({
      type: "helium-command-bar:activate-tab",
      tabId: tab.id,
      windowId: tab.windowId
    });
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
      await sendAction({
        type: "helium-command-bar:open-bookmark",
        bookmarkId: item.row.bookmark.id
      });
    } else if (item.row.kind === "closed") {
      await sendAction({
        type: "helium-command-bar:restore-session",
        sessionId: item.row.closed.sessionId
      });
    } else if (item.row.kind === "setting" || item.row.kind === "extension-setting") {
      await sendAction({
        type: "helium-command-bar:open-setting",
        settingId: item.row.setting.id,
        tabId: item.row.tab?.id
      });
    } else if (item.row.kind === "update" || item.row.kind === "extension-update") {
      reloadExtension();
    } else if (item.row.kind === "tab-action") {
      const action = item.row.action;
      await sendAction(action.id === "toggle-favorite"
        ? {
            type: "helium-command-bar:set-favorite",
            tabId: item.row.tabId,
            favorite: action.nextFavorite,
            bookmarkId: action.bookmarkId
          }
        : {
            type: "helium-command-bar:set-pinned",
            tabId: item.row.tabId,
            pinned: action.nextPinned
          });
    } else {
      await openInput();
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

  async function openInput() {
    await sendAction({
      type: "helium-command-bar:open-input",
      input: queryInput.value
    });
  }

  async function closeTab(tabId) {
    const response = await sendAction(
      { type: "helium-command-bar:close-tab", tabId },
      { close: false }
    );
    if (response?.ok && root.isConnected) {
      await refreshRows();
      queryInput.focus();
    }
  }

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeCommandBar();
  });
  queryInput.addEventListener("input", () => {
    splitNavigationKeys.clear();
    expandedSettingIds.clear();
    refreshRows({ resetSelection: true });
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
          candidate.kind === "row" &&
          candidate.row.parentSettingId === item.row.setting.id
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
          candidate.kind === "row" &&
          candidate.row.setting?.id === item.row.parentSettingId
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
      event.preventDefault();
      closeCommandBar();
    }
  });

  rows = initial.rows;
  renderRows();
  focusCommandBar();
  for (const delay of [0, 50, 150, 300]) {
    setTimeout(focusCommandBar, delay);
  }
})();
