/**
 * Unit checks for evidence photo prep (keep quality / no needless downscale).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/photo-upload.ts"), "utf8");

assert.match(src, /export async function prepareEvidencePhoto/);
assert.match(src, /export async function uploadEvidencePhotos/);
assert.match(src, /uploadBytesResumable/);
assert.match(src, /EVIDENCE_JPEG_QUALITY\s*=\s*0\.92/);
assert.match(src, /EVIDENCE_MAX_EDGE\s*=\s*4096/);
assert.match(src, /keepAsIs/);
assert.match(src, /keep tax-evidence detail|คงคุณภาพ|Keeps original bytes/);
assert.match(src, /No data-URL fallback/);
assert.match(src, /uploadViaCloudFunctionBytes/);

console.log("OK test-evidence-photo-upload");
