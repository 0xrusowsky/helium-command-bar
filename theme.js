export const DEFAULT_COMMAND_BAR_COLOR = "#505156";

export function normalizeThemeColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLocaleLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${[...color.slice(1)].map((character) => character.repeat(2)).join("")}`.toLocaleLowerCase();
  }
  return DEFAULT_COMMAND_BAR_COLOR;
}

export function commandBarThemeCss(value, selector = ":root") {
  const color = normalizeThemeColor(value);
  return `
${selector} {
  --accent: ${color};
  --selected: color-mix(in srgb, ${color} 13%, var(--surface-strong, var(--surface)));
  --selected-border: color-mix(in srgb, ${color} 30%, transparent);
}

@media (prefers-color-scheme: dark) {
  ${selector} {
    --accent: color-mix(in srgb, ${color} 44%, white);
    --selected: color-mix(in srgb, ${color} 28%, var(--surface-strong, var(--surface)));
    --selected-border: color-mix(in srgb, ${color} 42%, transparent);
  }
}
`;
}

export function applyCommandBarTheme(document, value) {
  const styleId = "helium-command-bar-custom-theme";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.append(style);
  }
  style.textContent = commandBarThemeCss(value);
}
