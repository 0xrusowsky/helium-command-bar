import { normalizeThemeColor } from "./theme.js";

function colorChannels(value) {
  const color = normalizeThemeColor(value);
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function mixColor(value, target, amount) {
  const source = colorChannels(value);
  const mixed = source.map((channel, index) =>
    Math.round(channel + (target[index] - channel) * amount)
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function extensionIconSvg(value) {
  const color = normalizeThemeColor(value);
  const light = mixColor(color, [255, 255, 255], 0.16);
  const dark = mixColor(color, [0, 0, 0], 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="20" y1="8" x2="108" y2="120" gradientUnits="userSpaceOnUse">
      <stop stop-color="${light}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="30" fill="url(#bg)"/>
  <circle cx="53" cy="51" r="27" fill="none" stroke="white" stroke-width="9"/>
  <path d="M53 28v46" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" opacity=".78"/>
  <path d="m73 71 27 27" fill="none" stroke="white" stroke-width="10" stroke-linecap="round"/>
</svg>`;
}

export function extensionIconDataUrl(value) {
  return `data:image/svg+xml,${encodeURIComponent(extensionIconSvg(value))}`;
}

function roundedRectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

export function createExtensionIconImageData(value, size) {
  const color = normalizeThemeColor(value);
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  const scale = size / 128;
  const gradient = context.createLinearGradient(20 * scale, 8 * scale, 108 * scale, 120 * scale);
  gradient.addColorStop(0, mixColor(color, [255, 255, 255], 0.16));
  gradient.addColorStop(1, mixColor(color, [0, 0, 0], 0.12));

  roundedRectangle(context, 0, 0, size, size, 30 * scale);
  context.fillStyle = gradient;
  context.fill();

  context.strokeStyle = "#fff";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(1.5, 9 * scale);
  context.beginPath();
  context.arc(53 * scale, 51 * scale, 27 * scale, 0, Math.PI * 2);
  context.stroke();

  context.save();
  context.globalAlpha = 0.78;
  context.lineWidth = Math.max(1.25, 7 * scale);
  context.beginPath();
  context.moveTo(53 * scale, 28 * scale);
  context.lineTo(53 * scale, 74 * scale);
  context.stroke();
  context.restore();

  context.lineWidth = Math.max(1.75, 10 * scale);
  context.beginPath();
  context.moveTo(73 * scale, 71 * scale);
  context.lineTo(100 * scale, 98 * scale);
  context.stroke();

  return context.getImageData(0, 0, size, size);
}
