/**
 * POS-vs-platform order: menu sequence in category, option groups on item, choices in group.
 * Run: npx tsx scripts/test-menu-channel-order.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  keepLiveOrderFields,
  liveOrdinalMap,
  namedListOrderStatus,
  sequenceStatus,
  sequenceWrongIds,
  worstOrderStatus,
  rowHasOrderIssue,
  rowMatchesFilter,
  type ChannelPriceCell,
} from "../src/lib/menu-channel-price";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

const aBeforeB = sequenceWrongIds(
  ["a", "b", "c"],
  new Map([
    ["a", 0],
    ["b", 1],
    ["c", 2],
  ]),
);
assert(aBeforeB.size === 0, "matching order should be empty");
assert(sequenceStatus(["a", "b", "c"], new Map([["a", 0], ["b", 1], ["c", 2]]), "b") === "ok", "b ok");

const swapped = sequenceWrongIds(
  ["a", "b", "c"],
  new Map([
    ["a", 0],
    ["b", 2],
    ["c", 1],
  ]),
);
assert(swapped.has("b") && swapped.has("c"), `swap b/c should mark both, got ${[...swapped]}`);
assert(!swapped.has("a"), "a stayed first");
assert(sequenceStatus(["a", "b", "c"], new Map([["a", 0], ["b", 2], ["c", 1]]), "b") === "wrong", "b wrong");
assert(sequenceStatus(["a", "b", "c"], new Map([["a", 0], ["b", 2], ["c", 1]]), "missing") === "unknown", "no scan → unknown");

const liveOrd = liveOrdinalMap(
  ["a", "b", "c"],
  new Map([
    ["a", 10],
    ["b", 30],
    ["c", 20],
  ]),
);
assert(liveOrd.get("a") === 1 && liveOrd.get("c") === 2 && liveOrd.get("b") === 3, "live ordinal follows scan index");

assert(namedListOrderStatus(["ความหวาน", "ท้อปปิ้ง"], ["ความหวาน", "ท้อปปิ้ง"]) === "ok", "groups same");
assert(
  namedListOrderStatus(["ความหวาน", "ท้อปปิ้ง"], ["ท้อปปิ้ง", "ความหวาน"]) === "wrong",
  "groups reversed",
);
assert(namedListOrderStatus(["ความหวาน", "ท้อปปิ้ง"], null) === "unknown", "no live groups");
assert(namedListOrderStatus(["ท้อปปิ้ง"], ["ท้อปปิ้ง"]) === "ok", "single group cannot be out of order");

assert(worstOrderStatus("ok", "unknown") === "ok", "ok + unknown = ok");
assert(worstOrderStatus("ok", "wrong") === "wrong", "any wrong wins");
assert(worstOrderStatus("unknown", "unknown") === "unknown", "all unknown");

const cellWrong = { orderStatus: "wrong", groupOrderStatus: "ok" } as ChannelPriceCell;
const cellOk = { orderStatus: "ok" } as ChannelPriceCell;
assert(
  rowHasOrderIssue({ shopee: cellWrong, grab: cellOk, lineman: cellOk }, ["shopee", "grab"]),
  "filter sees S wrong",
);
assert(
  !rowHasOrderIssue({ shopee: cellOk, grab: cellOk, lineman: cellOk }, ["grab"]),
  "ok rows not an order issue",
);
assert(
  rowMatchesFilter("match", { shopee: cellWrong, grab: cellOk, lineman: cellOk }, "order_issue", [
    "shopee",
  ]),
  "order_issue filter",
);

const kept = keepLiveOrderFields(
  { name: "ชา", price: 46, sortIndex: 12, groupNames: ["ความหวาน", "ท้อปปิ้ง"], choiceIndex: 3 },
  { name: "ชา", price: 53, source: "apply" },
);
assert(kept.sortIndex === 12, "apply keeps sortIndex");
assert(kept.groupNames?.[0] === "ความหวาน", "apply keeps groupNames");
assert(kept.choiceIndex === 3, "apply keeps choiceIndex");
assert(kept.price === 53, "new price wins");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const hub = read("src/components/PosMenuChannelPriceHub.tsx");
const lib = read("src/lib/menu-channel-price.ts");
const ingest = read("scripts/channel-scan-to-hub.mjs");
const grab = read("scripts/grab-api-scan.mjs");
const css = read("src/app/globals.css");

assert(lib.includes("order_issue"), "lib HubStatusFilter order_issue");
assert(lib.includes("categoryNameStatusFor"), "category name compare");
assert(lib.includes("liveOrdinalMap"), "live ordinal helper");
assert(hub.includes("HubNameMarks"), "name marks in menu column");
assert(hub.includes("HubCatMarks"), "cat marks in category column");
assert(hub.includes("HubChMark"), "colored S/G/L pills");
assert(hub.includes("catOrderWrong"), "cat pill ⇅ only when category order is wrong");
assert(hub.includes("liveSortRank"), "live rank number in cat column");
assert(hub.includes("mph-cat-rank"), "POS rank badge in cat column");
assert(hub.includes("HubItemOrderMarks"), "item-in-category marks in menu column");
assert(hub.includes("liveItemRank"), "live item rank in menu column");
assert(hub.includes("ลำดับ S/G/L"), "cat header says where order is");
assert(hub.includes("ชื่อ · ลำดับในหมวด"), "name header says name + item order");
assert(css.includes("mph-ch-mark"), "pill marks");
assert(css.includes("mph-cat-rank"), "POS rank style");
assert(hub.includes('["order_issue"'), "ลำดับ chip");
assert(!hub.includes("HubOrderMarks"), "old header marks removed");
assert(!hub.includes("kind=\"item\""), "no extra column");
assert(ingest.includes("sortIndex"), "ingest sortIndex");
assert(ingest.includes("choiceIndex"), "ingest choiceIndex");
assert(ingest.includes("groupNames"), "ingest groupNames");
assert(ingest.includes("category: o.group"), "option live group in category field");
assert(grab.includes("optionGroupNames"), "grab scan linked groups");
assert(css.includes("mph-cat-cell"), "cat cell layout");
assert(css.includes(".mph-name-cell {"), "name cell layout");
assert(/\.mph-name-cell \{[\s\S]*?flex-direction: column/.test(css), "name marks below menu name");
assert(/\.mph-cat-cell \{[\s\S]*?flex-direction: column/.test(css), "cat marks below category name");
assert(css.includes("is-order-warn"), "order warn cell");

console.log("ok menu channel order");
