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
assert.equal(appVersionLabel(), `4.${APP_BUILD}`);
assert.doesNotMatch(appVersionLabel(), /\d{2}\/\d{2}\/\d{2}/);
console.log("test-app-version: ok ·", appVersionString());
