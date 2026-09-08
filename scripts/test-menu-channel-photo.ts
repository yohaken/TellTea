/**
 * Confirmed POS main photo vs platform photo id — not filenames.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { menuMainImageHash } from "../src/lib/pos-menu-image";
import {
  channelPhotoStatusFor,
  rowHasPhotoIssue,
  type ChannelPriceCell,
  type DeliveryChannel,
} from "../src/lib/menu-channel-price";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const a = menuMainImageHash("data:image/jpeg;base64,AAAA");
const b = menuMainImageHash("data:image/jpeg;base64,BBBB");
assert.ok(a);
assert.notEqual(a, b);
assert.equal(menuMainImageHash(""), "");
assert.equal(menuMainImageHash("data:image/jpeg;base64,AAAA"), a);

assert.equal(
  channelPhotoStatusFor({
    storeOnly: true,
    posHash: a,
    livePhotoId: "th-1",
    photoKnown: true,
  }),
  "skip",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: "",
    livePhotoId: "",
    photoKnown: true,
  }),
  "none",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId: "",
    photoKnown: false,
  }),
  "unknown",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId: "",
    photoKnown: true,
  }),
  "missing",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId: "th-live",
    photoKnown: true,
  }),
  "pending",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId: "th-live",
    photoKnown: true,
    pushedId: "th-live",
    pushedHash: a,
  }),
  "pending",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId: "th-live",
    photoKnown: true,
    pushedId: "th-live",
    pushedHash: a,
    verifiedAt: "2026-09-06T00:00:00.000Z",
  }),
  "match",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: b,
    livePhotoId: "th-live",
    photoKnown: true,
    pushedId: "th-live",
    pushedHash: a,
  }),
  "stale",
);
assert.equal(
  channelPhotoStatusFor({
    posHash: a,
    livePhotoId:
      "https://food-cms.grab.com/item/THITE1/photos/menueditor_item_abc_1.jpeg",
    photoKnown: true,
    pushedId: "menueditor_item_abc_1.jpeg",
    pushedHash: a,
    verifiedAt: "2026-09-08T00:00:00.000Z",
  }),
  "match",
  "Grab CDN URL vs filename should match",
);

function cells(photo: Record<DeliveryChannel, ChannelPriceCell["photoStatus"]>) {
  return {
    shopee: { photoStatus: photo.shopee } as ChannelPriceCell,
    grab: { photoStatus: photo.grab } as ChannelPriceCell,
    lineman: { photoStatus: photo.lineman } as ChannelPriceCell,
  };
}

assert.equal(
  rowHasPhotoIssue(cells({ shopee: "pending", grab: "unknown", lineman: "unknown" })),
  false,
);
assert.equal(
  rowHasPhotoIssue(cells({ shopee: "missing", grab: "unknown", lineman: "unknown" })),
  true,
);

const hub = read("src/components/PosMenuChannelPriceHub.tsx");
const ingest = read("scripts/channel-scan-to-hub.mjs");
assert.match(hub, /HubPhotoMarks/);
assert.match(hub, /verifiedAt: stored\?\.photoVerifiedAt/);
assert.match(hub, /photo_issue/);
assert.match(ingest, /function livePhotoId/);
assert.doesNotMatch(ingest, /v1-โทนเขียว/);

console.log("ok: menu-channel-photo");
