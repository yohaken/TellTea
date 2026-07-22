/**
 * OT bonus rate setup lives only on /bonus (RateSchedulePanel), not settings.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const settings = read("src/app/settings/page.tsx");
const bonus = read("src/app/bonus/page.tsx");
const more = read("src/app/more/page.tsx");
const version = read("src/lib/version.ts");

assert.match(version, /APP_BUILD = 246/);
assert.doesNotMatch(settings, /OtBonusRateSetup|บันทึกเรท/);
assert.match(settings, /เรทโบนัสอยู่หน้า สรุปโบนัส/);
assert.match(bonus, /RateSchedulePanel/);
assert.match(more, /สินค้าผลิตอยู่หน้าผลิต/);
assert.equal(existsSync(join(root, "src/components/OtBonusRateSetup.tsx")), false);

console.log("OK test-ot-rate-settings-dedupe");
