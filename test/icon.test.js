import assert from "node:assert/strict";
import test from "node:test";

import {
  extensionIconDataUrl,
  extensionIconSvg,
} from "../icon.js";

test("builds a themed split-search extension icon", () => {
  const neutral = extensionIconSvg("invalid");
  assert.match(neutral, /^<svg/);
  assert.match(neutral, /linearGradient/);
  assert.match(neutral, /<circle cx="53" cy="51"/);
  assert.match(neutral, /M53 28v46/);
  assert.match(neutral, /#6c6d71/);
  assert.match(extensionIconDataUrl("#3973c6"), /^data:image\/svg\+xml,/);
  assert.notEqual(extensionIconSvg("#3973c6"), neutral);
});
