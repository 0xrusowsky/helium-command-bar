import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions } from "../update.js";

test("compares extension versions numerically", () => {
  assert.equal(compareVersions("0.24.0", "0.23.9"), 1);
  assert.equal(compareVersions("0.23.0", "0.23.0"), 0);
  assert.equal(compareVersions("0.22.10", "0.23.0"), -1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});
