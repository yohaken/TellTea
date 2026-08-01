import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { defaultVatCloseMonthKey } from "../src/lib/vat-monthly";
import {
  amountsHaveValue,
  emptyIngestByChannel,
  ingestMonthConfirmStorageKey,
  mapIngestDraft,
  needsIngestMonthConfirm,
  saveIngestDraft,
} from "../src/lib/vat-delivery-ingest-draft";

assert.equal(
  needsIngestMonthConfirm({ hasSavedImages: false, alreadyConfirmed: false }),
  true,
);
assert.equal(
  needsIngestMonthConfirm({ hasSavedImages: true, alreadyConfirmed: false }),
  false,
);
assert.equal(
  needsIngestMonthConfirm({ hasSavedImages: false, alreadyConfirmed: true }),
  false,
);
assert.equal(
  needsIngestMonthConfirm({ hasSavedImages: true, alreadyConfirmed: true }),
  false,
);

assert.equal(
  ingestMonthConfirmStorageKey("2026-07"),
  "vat-ingest-up-ok:2026-07",
);

const mapped = mapIngestDraft("2026-07", {
  byChannel: {
    grab: { sales: 1000.5, transfer: 700, fee: 250, gpVat: 17.5 },
    shopee: { sales: "2000", transfer: 1500, fee: 400, gpVat: 28 },
    lineman: {},
  },
  images: [
    {
      id: "a1",
      fileName: "grab.png",
      storagePath: "vat-imports/2026/07/capture/a1-grab.jpg",
      downloadUrl: "https://example.com/a1.jpg",
      contentHash: "a1",
      channel: "grab",
    },
    {
      id: "bad",
      fileName: "x.png",
      storagePath: "",
      downloadUrl: "",
    },
  ],
  updatedAt: 123,
  updatedBy: "owner-1",
});

assert.equal(mapped.monthKey, "2026-07");
assert.equal(mapped.byChannel.grab.sales, 1000.5);
assert.equal(mapped.byChannel.shopee.sales, 2000);
assert.equal(mapped.byChannel.lineman.sales, 0);
assert.equal(mapped.images.length, 1);
assert.equal(mapped.images[0].channel, "grab");
assert.equal(mapped.updatedBy, "owner-1");

assert.equal(amountsHaveValue(mapped.byChannel.grab), true);
assert.equal(amountsHaveValue(emptyIngestByChannel().lineman), false);

// ต้นเดือน ส.ค. → default ปิดงบ = ก.ค. (กันอัปผิดเดือน)
const aug1Bangkok = Date.parse("2026-07-31T17:00:00.000Z");
assert.equal(defaultVatCloseMonthKey(aug1Bangkok), "2026-07");

// เซฟเดือนผิด → เด้งทันที ไม่ค้าง
void saveIngestDraft({
  monthKey: "bad",
  byChannel: emptyIngestByChannel(),
  images: [],
  updatedAt: 1,
  updatedBy: "tester",
})
  .then(() => {
    throw new Error("ควร reject เดือนไม่ถูกต้อง");
  })
  .catch((e) => {
    assert.equal(e instanceof Error ? e.message : String(e), "เดือนไม่ถูกต้อง");
  })
  .then(() => {
    // ย่อรูปต้องใช้ compressImageForUpload (createImageBitmap) — กัน path ช้าเดิม
    const draftSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/vat-delivery-ingest-draft.ts"),
      "utf8",
    );
    assert.match(draftSrc, /compressImageForUpload/);
    assert.doesNotMatch(draftSrc, /toDataURL\("image\/jpeg"/);
    assert.doesNotMatch(draftSrc, /atob\(/);
    assert.match(draftSrc, /SKIP_COMPRESS_JPEG_BYTES/);

    const uiSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/vat-sales/VatIngestSources.tsx"),
      "utf8",
    );
    assert.match(uiSrc, /defaultVatCloseMonthKey/);
    assert.match(uiSrc, /เดือนถูกต้องไหม/);
    assert.match(uiSrc, /needsIngestMonthConfirm/);
    assert.match(uiSrc, /onAddCaptureClick/);

    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    assert.match(css, /\.vat-ingest-preview-slim \{[\s\S]*?width: 100%;/);
    assert.match(css, /table-layout: fixed;/);
    assert.match(css, /\.vat-ingest-month-confirm/);

    console.log("test-vat-delivery-ingest-draft: ok");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
