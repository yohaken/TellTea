import assert from "node:assert/strict";
import {
  APP_BUILD,
  APP_VERSION_MAJOR,
  appVersionLabel,
  appVersionString,
} from "../src/lib/version";

assert.equal(APP_VERSION_MAJOR, 4);
assert.ok(APP_BUILD >= 433);
assert.equal(appVersionString(), `4.${APP_BUILD}`);
assert.ok(appVersionLabel().startsWith(`4.${APP_BUILD}`));
console.log("test-app-version: ok ·", appVersionString());
