/**
 * Phase 4: owner photo forensics scan + table highlight.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

assert.match(read("src/lib/photo-forensics-scan.ts"), /scanPhotoForensics/);
assert.match(read("src/lib/photo-forensics-scan.ts"), /contentHash/);
assert.match(read("src/lib/photo-forensics-scan.ts"), /dateMismatch/);
assert.match(read("src/lib/evidence-photos.ts"), /getEvidencePhotoMetaMany/);
assert.match(read("src/components/PhotoForensicsPanel.tsx"), /ตรวจ \$\{lookbackDays\} วัน/);
assert.match(read("src/lib/photo-forensics-scan.ts"), /PHOTO_FORENSICS_LOOKBACK_DAYS\s*=\s*10/);
assert.match(read("src/app/production/page.tsx"), /PhotoForensicsPanel/);
assert.match(read("src/app/ot/page.tsx"), /PhotoForensicsPanel/);
assert.match(read("src/app/globals.css"), /photo-forensics-panel/);
assert.match(read("docs/photo-forensics-checklist.md"), /Phase 4/);
assert.match(read("src/lib/version.ts"), /APP_BUILD\s*=\s*274/);

console.log("OK test-photo-forensics-report");
