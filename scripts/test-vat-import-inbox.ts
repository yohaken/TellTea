/**
 * Pure tests — Storage inbox helpers (strict + dedupe)
 */
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  channelFromStoragePath,
  isStorageFileAlreadyInRows,
  pendingInboxRow,
  INBOX_PENDING_ADAPTER_ID,
} from "../src/lib/vat-import-inbox";
import { hashBytesSha256 } from "../src/lib/vat-import-hash";
import type { VatImportRow } from "../src/lib/vat-import";

if (!globalThis.crypto?.subtle) {
  // Node test env
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

assert.equal(
  channelFromStoragePath("vat-imports/2026/07/lineman/abc-report.pdf"),
  "lineman",
);
assert.equal(
  channelFromStoragePath("vat-imports/2026/07/shopee/inv.pdf"),
  "shopee",
);
assert.equal(
  channelFromStoragePath("vat-imports/2026/07/grab/t.csv"),
  "grab",
);
assert.equal(
  channelFromStoragePath("vat-imports/2026/07/storefront/x.pdf"),
  "storefront",
);

const rows = [
  {
    id: "1",
    storagePath: "vat-imports/2026/07/grab/a.csv",
    contentHash: "abc123",
  },
  {
    id: "2",
    storagePath: "vat-imports/2026/07/shopee/b.pdf",
    contentHash: "md5:xyz",
  },
] as VatImportRow[];

assert.equal(
  isStorageFileAlreadyInRows(
    { storagePath: "vat-imports/2026/07/grab/a.csv", md5Hash: null },
    rows,
  ),
  true,
);
assert.equal(
  isStorageFileAlreadyInRows(
    {
      storagePath: "vat-imports/2026/07/grab/new.csv",
      md5Hash: null,
      contentHash: "abc123",
    },
    rows,
  ),
  true,
);
assert.equal(
  isStorageFileAlreadyInRows(
    {
      storagePath: "vat-imports/2026/07/grab/new2.csv",
      md5Hash: "xyz",
    },
    rows,
  ),
  true,
);
assert.equal(
  isStorageFileAlreadyInRows(
    {
      storagePath: "vat-imports/2026/07/grab/fresh.csv",
      md5Hash: null,
      contentHash: "ffff",
    },
    rows,
  ),
  false,
);

const pending = pendingInboxRow(
  "2026-07",
  {
    storagePath: "vat-imports/2026/07/grab/x.csv",
    name: "x.csv",
    channel: "grab",
    size: 10,
    contentType: "text/csv",
    md5Hash: null,
    updated: null,
    downloadUrl: "https://example.com/x.csv",
  },
  "hash99",
  "รอแปลง",
);
assert.equal(pending.adapterId, INBOX_PENDING_ADAPTER_ID);
assert.equal(pending.grossInclusive, 0);
assert.equal(pending.fee, 0);
assert.equal(pending.netTransfer, 0);
assert.equal(pending.gpVat, 0);
assert.equal(pending.invoiceNo, "");
assert.equal(pending.contentHash, "hash99");
assert.equal(pending.externalId, "inbox:hash99");
assert.equal(pending.note, "รอแปลง");

void (async () => {
  const h = await hashBytesSha256(new TextEncoder().encode("hello"));
  assert.equal(
    h,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  console.log("test-vat-import-inbox: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

