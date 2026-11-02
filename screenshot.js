const image = document.querySelector("#image");
const status = document.querySelector("#status");
const copyButton = document.querySelector("#copy");
const saveLink = document.querySelector("#save");

async function copyImage() {
  try {
    const blob = await (await fetch(image.src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    status.textContent = "Copied to clipboard";
  } catch (error) {
    status.textContent = "Could not copy automatically";
    console.info("Could not copy the screenshot", error);
  }
}

const response = await chrome.runtime.sendMessage({ type: "helium-command-bar:get-screenshot" });
if (response?.dataUrl) {
  image.src = response.dataUrl;
  saveLink.href = response.dataUrl;
  saveLink.download = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  copyButton.addEventListener("click", copyImage);
  await image.decode();
  await copyImage();
} else {
  status.textContent = "The screenshot is no longer available";
  copyButton.disabled = true;
}
