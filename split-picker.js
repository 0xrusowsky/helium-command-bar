import { resolveInput } from "./search.js";
import {
  DEFAULT_COMMAND_BAR_COLOR,
  applyCommandBarTheme
} from "./theme.js";

const queryInput = document.querySelector("#query");
const actionsElement = document.querySelector("#actions");
const sectionLabel = document.querySelector(".section-label");
const closeButton = document.querySelector("#close");
const errorElement = document.querySelector("#error");

let rows = [];
let selectedIndex = 0;
let queryGeneration = 0;
let busy = false;

function svgIcon(pathData) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

function hostnameFor(item) {
  const value = item.url || item.pendingUrl || "";
  try {
    const url = new URL(value);
    return url.hostname || url.protocol.replace(":", "");
  } catch {
    return value;
  }
}

function createFavicon(item, closed = false) {
  const box = document.createElement("span");
  box.className = `favicon-box${closed ? " closed" : ""}`;
  const fallback = document.createElement("span");
  fallback.textContent = (item.title || hostnameFor(item) || "T").trim().charAt(0).toLocaleUpperCase();
  box.append(fallback);

  if (item.favIconUrl && !item.favIconUrl.startsWith("chrome://")) {
    const image = document.createElement("img");
    image.src = item.favIconUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("load", () => fallback.remove());
    image.addEventListener("error", () => image.remove());
    box.append(image);
  }
  return box;
}

function setSelected(index, { scroll = true } = {}) {
  if (!rows.length) return;
  selectedIndex = (index + rows.length) % rows.length;
  [...actionsElement.children].forEach((element, itemIndex) => {
    const selected = itemIndex === selectedIndex;
    element.classList.toggle("selected", selected);
    element.setAttribute("aria-selected", String(selected));
  });
  const selected = actionsElement.children[selectedIndex];
  queryInput.setAttribute("aria-activedescendant", selected?.id || "");
  if (scroll) selected?.scrollIntoView({ block: "nearest" });
}

function createActionRow(row, index) {
  const element = document.createElement("li");
  element.className = `action-row ${row.kind}`;
  element.id = `action-${index}`;
  element.setAttribute("role", "option");

  if (row.kind === "launch") {
    const iconBox = document.createElement("span");
    iconBox.className = "action-icon";
    iconBox.append(svgIcon(
      row.target.kind === "url"
        ? "M14 5h5v5m0-5L10 14m7 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"
        : "m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
    ));
    element.append(iconBox);
  } else if (row.kind === "tab") {
    element.append(createFavicon(row.tab));
  } else {
    element.append(createFavicon(row.closed, true));
  }

  const details = document.createElement("span");
  details.className = "action-details";
  const title = document.createElement("span");
  title.className = "action-title";
  const subtitle = document.createElement("span");
  subtitle.className = "action-subtitle";

  if (row.kind === "launch") {
    title.textContent = row.target.kind === "url"
      ? `Open ${row.target.display}`
      : `Search for “${row.target.text}”`;
    subtitle.textContent = row.target.kind === "url"
      ? "Open directly in this split pane"
      : "Use your default search engine in this split pane";
  } else if (row.kind === "tab") {
    title.textContent = row.tab.title || "Untitled tab";
    subtitle.textContent = `${hostnameFor(row.tab)} · Open a copy in this split`;
  } else {
    title.textContent = row.closed.title || "Recently closed tab";
    const location = hostnameFor(row.closed);
    subtitle.textContent = `${location ? `${location} · ` : ""}Reopen in this split`;
  }
  details.append(title, subtitle);

  const trailing = document.createElement(row.kind === "launch" ? "kbd" : "span");
  trailing.className = row.kind === "launch" ? "" : `action-pill ${row.kind}`;
  trailing.textContent = row.kind === "launch" ? "↵" : row.kind === "tab" ? "Open" : "Recent";
  element.append(details, trailing);
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("mouseenter", () => setSelected(index, { scroll: false }));
  element.addEventListener("click", () => activate(index));
  return element;
}

function render() {
  actionsElement.replaceChildren(...rows.map(createActionRow));
  selectedIndex = Math.max(0, Math.min(selectedIndex, rows.length - 1));
  setSelected(selectedIndex, { scroll: false });
}

async function loadRows({ resetSelection = false } = {}) {
  const generation = ++queryGeneration;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "split-picker:query",
      query: queryInput.value
    });
    if (generation !== queryGeneration || !response) return;
    rows = response.rows;
    sectionLabel.textContent = response.label;
    if (resetSelection) selectedIndex = 0;
    render();
  } catch (error) {
    errorElement.textContent = error.message || "Could not load tabs.";
    errorElement.hidden = false;
  }
}

async function send(message) {
  if (busy) return;
  busy = true;
  errorElement.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error("The browser did not complete the action.");
  } catch (error) {
    busy = false;
    errorElement.textContent = error.message || "Could not complete the action.";
    errorElement.hidden = false;
    queryInput.focus();
  }
}

async function openInput() {
  if (!resolveInput(queryInput.value)) return;
  await send({ type: "split-picker:open-input", input: queryInput.value });
}

async function activate(index = selectedIndex) {
  const row = rows[index];
  if (!row) return;
  if (row.kind === "launch") {
    await openInput();
  } else if (row.kind === "tab") {
    await send({ type: "split-picker:open-tab", tabId: row.tab.id });
  } else {
    await send({ type: "split-picker:open-closed", sessionId: row.closed.sessionId });
  }
}

queryInput.addEventListener("input", () => loadRows({ resetSelection: true }));
queryInput.addEventListener("keydown", async (event) => {
  if (event.isComposing) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setSelected(selectedIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setSelected(selectedIndex - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) await openInput();
    else await activate();
  } else if (event.key === "Escape") {
    event.preventDefault();
    await send({ type: "split-picker:close" });
  }
});
closeButton.addEventListener("click", () => send({ type: "split-picker:close" }));
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.commandBarColor) {
    applyCommandBarTheme(document, changes.commandBarColor.newValue);
  }
});

const themeSettings = await chrome.storage.sync.get({
  commandBarColor: DEFAULT_COMMAND_BAR_COLOR
});
applyCommandBarTheme(document, themeSettings.commandBarColor);
await loadRows();
queryInput.focus();
