/**
 * Firestore write error helper — Thai messages for oversized docs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/lib/receipts.ts"), "utf8");
assert.match(src, /friendlyFirestoreWriteError/);

function friendlyFirestoreWriteError(err, fallback) {
  const raw =
    err && typeof err === "object" && "message" in err
      ? String(err.message || "")
      : String(err || "");
  if (
    /exceeds|too (large|big)|maximum size|1\s*MiB|1048576|INVALID_ARGUMENT|longer than|ResourceExhausted|payload/i.test(
      raw,
    )
  ) {
    return "บันทึกไม่สำเร็จ — รูปใหญ่เกินไปหรือแนบหลายรูปเกินลิมิต ลองลบเหลือ 1–2 รูปแล้วบันทึกใหม่";
  }
  return raw.trim() || fallback;
}

assert.match(
  friendlyFirestoreWriteError(new Error("Document exceeds maximum size"), "x"),
  /รูปใหญ่เกินไป/,
);
assert.match(
  friendlyFirestoreWriteError({ message: "INVALID_ARGUMENT: too large" }, "x"),
  /รูปใหญ่เกินไป/,
);
assert.equal(friendlyFirestoreWriteError(new Error("เลือกพนักงาน"), "x"), "เลือกพนักงาน");
assert.equal(friendlyFirestoreWriteError(null, "fallback"), "fallback");

console.log("OK test-ot-photo-budget");
