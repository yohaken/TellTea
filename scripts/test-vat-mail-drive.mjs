/**
 * Unit tests for Drive spine helpers (no network).
 * Run: node scripts/test-vat-mail-drive.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdf = require("../functions/vat-mail-pdf.js");
const drive = require("../functions/vat-mail-drive.js");

const parts = pdf.listDriveableParts({
  mimeType: "multipart/mixed",
  parts: [
    {
      filename: "daily.pdf",
      mimeType: "application/pdf",
      body: { attachmentId: "a1", size: 100 },
    },
    {
      filename: "report.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: { attachmentId: "a2", size: 200 },
    },
    {
      filename: "settlement.csv",
      mimeType: "text/csv",
      body: { attachmentId: "a3", size: 50 },
    },
    {
      filename: "skip.txt",
      mimeType: "text/plain",
      body: { attachmentId: "a4", size: 10 },
    },
  ],
});

assert.equal(parts.length, 3);
assert.equal(parts[0].kind, "pdf");
assert.equal(parts[1].kind, "xlsx");
assert.equal(parts[2].kind, "csv");

assert.equal(drive.scopeHasDrive("https://www.googleapis.com/auth/gmail.readonly"), false);
assert.equal(
  drive.scopeHasDrive(
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file",
  ),
  true,
);

assert.equal(
  drive.monthKeyFromReport({ reportDateGuess: "2026-07-15" }),
  "2026-07",
);
assert.equal(
  drive.monthKeyFromReport({ reportDateGuess: "2026-08" }),
  "2026-08",
);

const st = drive.publicDriveStatus(
  { scope: "https://www.googleapis.com/auth/drive.file", refreshToken: "x" },
  { rootFolderId: "root1", rootFolderName: "TellTea-VAT", lastSyncUploaded: 2 },
);
assert.equal(st.hasDriveScope, true);
assert.equal(st.rootFolderId, "root1");
assert.equal(st.lastDriveSyncUploaded, 2);

console.log("test-vat-mail-drive: ok");
