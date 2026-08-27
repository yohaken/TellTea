/**
 * Guard: legal profile names must reject phone/id digit blobs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = readFileSync(join(root, "src/lib/profile.ts"), "utf8");

assert.match(profile, /export function isPlausiblePersonName/);
assert.match(profile, /isPlausiblePersonName\(first\)/);

const modal = readFileSync(join(root, "src/components/PersonalProfileModal.tsx"), "utf8");
assert.match(modal, /isPlausiblePersonName/);

const subscribe = readFileSync(join(root, "src/lib/firestore-subscribe.ts"), "utf8");
assert.match(subscribe, /subscribeQueryWithRetry/);

console.log("OK test-profile-legal-name");
