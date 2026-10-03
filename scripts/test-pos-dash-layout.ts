import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  layoutPosDashCards,
  movePosDashCard,
  normalizePosDashOrder,
  POS_DASH_CARDS,
  POS_DASH_DEFAULT_ORDER,
  samePosDashOrder,
  type PosDashCardId,
} from "../src/lib/pos-dash-layout";

const D = POS_DASH_DEFAULT_ORDER;
assert.equal(new Set(D).size, D.length, "ids unique");
assert.equal(D.length, 16);
assert.equal(D[0], "daily");
assert.equal(D.at(-1), "void");

// normalize: empty / garbage → default
assert.deepEqual(normalizePosDashOrder(undefined), D);
assert.deepEqual(normalizePosDashOrder(null), D);
assert.deepEqual(normalizePosDashOrder("void"), D);
assert.deepEqual(normalizePosDashOrder([]), D);
assert.deepEqual(normalizePosDashOrder(["nope", 3, null]), D);

// dedupe + drop unknown, keep saved order
const saved = ["void", "daily", "void", "ghost", ...D.filter((id) => id !== "void" && id !== "daily")];
const n = normalizePosDashOrder(saved);
assert.equal(n.length, D.length);
assert.equal(n[0], "void");
assert.equal(n[1], "daily");

// a card added later (not in saved order) lands after its default predecessor
const withoutStats = ["void", ...D.filter((id) => id !== "stats" && id !== "void")];
const healed = normalizePosDashOrder(withoutStats);
assert.equal(healed.length, D.length);
assert.equal(healed[healed.indexOf("discount") + 1], "stats");
assert.equal(healed[0], "void");
// missing first default card goes to the top
const withoutDaily = normalizePosDashOrder(D.filter((id) => id !== "daily"));
assert.equal(withoutDaily[0], "daily");

// move
const m1 = movePosDashCard(D, D.length - 1, 0);
assert.equal(m1[0], "void");
assert.equal(m1.length, D.length);
assert.deepEqual(D[0], "daily", "input not mutated");
assert.deepEqual(movePosDashCard(D, 0, 99).at(-1), "daily");
assert.deepEqual(movePosDashCard(D, 0, -5), D);
assert.deepEqual(movePosDashCard(D, 99, 0), D);
assert.ok(samePosDashOrder(movePosDashCard(D, 3, 3), D));
assert.ok(!samePosDashOrder(m1, D));
assert.ok(!samePosDashOrder(D.slice(1), D));

// layout pairing: default → half cards pair up
const spans = (o: PosDashCardId[]) => layoutPosDashCards(o).map((x) => `${x.id}:${x.span}`);
assert.deepEqual(spans(D), [
  "daily:2", "ops:2", "net:1", "bills:1", "hour:1", "weekday:1", "timeTotals:2",
  "productHours:2", "products:1", "options:1", "stock:1", "discount:1", "stats:1",
  "activity:1", "members:2", "void:2",
]);
// lone half card (moved between full cards) expands to full row
const lone = movePosDashCard(D, D.indexOf("net"), 0);
const ls = spans(lone);
assert.equal(ls[0], "net:2");
assert.ok(ls.includes("bills:1") && ls.includes("hour:1"), "bills pairs with hour");
assert.ok(ls.includes("weekday:2"), "weekday now alone");
// every card rendered exactly once, total columns form complete rows
for (const order of [D, lone, m1, [...D].reverse()]) {
  const l = layoutPosDashCards(order);
  assert.equal(l.length, D.length);
  const halves = l.filter((x) => x.span === 1).length;
  assert.equal(halves % 2, 0, "half cards always in pairs");
}
assert.ok(POS_DASH_CARDS.every((c) => c.label.trim()));

// wiring
const dash = readFileSync("src/components/PosSalesDashboard.tsx", "utf8");
for (const id of D) assert.match(dash, new RegExp(`\\n    ${id}: `), `card map has ${id}`);
assert.match(dash, /layoutPosDashCards\(cardOrder\)/);
assert.match(dash, /subscribePosDashOrder/);
assert.match(dash, /savePosDashOrder\(next, user\?\.uid \|\| staff\?\.id/);
assert.match(dash, /จัดกล่อง/);
assert.doesNotMatch(dash, /pos-dash-(top-grid|chart-row|bottom-grid)/);
const ui = readFileSync("src/components/PosSalesDashboardLayoutSettings.tsx", "utf8");
assert.match(ui, /onPointerDown/);
// Drag tracked on window (pointer capture is lost when React re-inserts the dragged row).
assert.doesNotMatch(ui, /setPointerCapture/);
assert.match(ui, /window\.addEventListener\("pointermove", move\)/);
assert.match(ui, /window\.addEventListener\("pointerup", up\)/);
assert.match(ui, /window\.addEventListener\("pointercancel", cancel\)/);
assert.match(ui, /ArrowUp/);
assert.match(ui, /ค่าเริ่มต้น/);
const lib = readFileSync("src/lib/pos-dash-layout.ts", "utf8");
assert.match(lib, /doc\(getDb\(\), "meta", "ui"\)/);
assert.match(lib, /\{ merge: true \}/);
const css = readFileSync("src/app/globals.css", "utf8");
assert.match(css, /\.pos-dash-layout-handle \{[^}]*touch-action: none/);

console.log("test-pos-dash-layout: ok");
