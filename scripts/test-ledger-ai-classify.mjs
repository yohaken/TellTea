/**
 * Ledger AI classify — heuristic + CF helpers + UI wiring smoke.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));

const classify = require("./classify-ledger.js");
const labels = readFileSync(join(root, "src/lib/ledger-labels.ts"), "utf8");
const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const typeField = readFileSync(join(root, "src/components/LedgerTypeField.tsx"), "utf8");
const aiPanel = readFileSync(join(root, "src/components/LedgerAiSettingsPanel.tsx"), "utf8");
const ledgerAi = readFileSync(join(root, "src/lib/ledger-ai.ts"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");
const version = readFileSync(join(root, "src/lib/version.ts"), "utf8");

assert.equal(classify.normalizeType("cogs"), "cogs");
assert.equal(classify.normalizeType("SGA"), "sga");
assert.equal(classify.normalizeType("assets"), "asset");
assert.equal(classify.normalizeType("อื่นๆ"), "อื่นๆ");
assert.equal(classify.normalizeType("nope"), null);

assert.deepEqual(classify.extractJsonObject('{"type":"sga","reason":"ซ่อม"}'), {
  type: "sga",
  reason: "ซ่อม",
});
assert.equal(
  classify.extractJsonObject('hello {"type":"cogs","reason":"นม"} trailing')?.type,
  "cogs",
);

// Heuristic: ส่งเครื่องซ่อม / เครื่องดื่ม
assert.match(labels, /ส่งเครื่อง/);
assert.match(labels, /ซ่อม/);
assert.match(labels, /เครื่องดื่ม/);
assert.match(classify.SYSTEM_PROMPT, /เครื่องดื่ม/);

// Extract + eval guessTypeFromDescription body for smoke
const fnMatch = labels.match(
  /export function guessTypeFromDescription\(description: string\): string \{([\s\S]*?)\n\}/,
);
assert.ok(fnMatch, "guessTypeFromDescription missing");
const guess = vm.runInNewContext(
  `function guessTypeFromDescription(description) {${fnMatch[1]}}\nguessTypeFromDescription`,
);
assert.equal(guess("ค่าเครื่องดื่ม"), "cogs");
assert.equal(guess("ส่งเครื่องซ่อม"), "sga");
assert.equal(guess("ซื้อเครื่องชงกาแฟ"), "asset");

// UI wiring
assert.match(ledgerPage, /LedgerAiSettingsPanel/);
assert.match(ledgerPage, /resolveStoredTypeSource/);
assert.match(typeField, /จัดประเภทบัญชีโดย AI/);
assert.match(typeField, /ประเภทเดิมในระบบ/);
assert.match(typeField, /ใช้รูป/);
assert.match(typeField, /จัดประเภทใหม่ด้วย AI/);
assert.match(typeField, /onReclassify/);
assert.match(ledgerPage, /onReclassify/);
assert.match(aiPanel, /จัดประเภทใหม่ด้วย AI — ก\.ค\./);
assert.match(ledgerAi, /reclassifyLedgerMonthWithAi/);
assert.match(ledgerAi, /imageUrls/);
assert.match(classify.SYSTEM_PROMPT, /รูป/);
assert.equal(classify.isAllowedImageUrl("https://firebasestorage.googleapis.com/v0/b/x/o/y"), true);
assert.equal(classify.isAllowedImageUrl("https://evil.example/a.png"), false);
assert.match(rules, /aiSettings/);
assert.match(version, /APP_BUILD = 191/);

// Live Gemini smoke — key from env (or skip)
const key = String(process.env.GEMINI_API_KEY || "").trim();
if (!key) {
  console.log("OK test-ledger-ai-classify (skip live — no GEMINI_API_KEY)");
  process.exit(0);
}

async function liveClassify(description) {
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `ชื่อรายการ: ${description}` }] }],
      systemInstruction: { parts: [{ text: classify.SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });
  const body = await res.json();
  assert.equal(res.ok, true, body?.error?.message || `HTTP ${res.status}`);
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const parsed = classify.extractJsonObject(text);
  const type = classify.normalizeType(parsed?.type);
  assert.ok(type, `no type from AI: ${text}`);
  return type;
}

const repairType = await liveClassify("ส่งเครื่องซ่อม");
assert.equal(repairType, "sga", `expected sga for ส่งเครื่องซ่อม, got ${repairType}`);

const drinkType = await liveClassify("ค่าเครื่องดื่ม");
assert.equal(drinkType, "cogs", `expected cogs for ค่าเครื่องดื่ม, got ${drinkType}`);

const milkType = await liveClassify("นมสดแม็คโคร");
assert.ok(["cogs", "sga"].includes(milkType), `milk got ${milkType}`);

console.log("OK test-ledger-ai-classify");
