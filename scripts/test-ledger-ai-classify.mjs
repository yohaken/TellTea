/**
 * Ledger AI classify — heuristic + CF helpers + UI wiring smoke.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "functions/package.json"));

const classify = require("./classify-ledger.js");
const labels = readFileSync(join(root, "src/lib/ledger-labels.ts"), "utf8");
const ledgerPage = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
const typeField = readFileSync(join(root, "src/components/LedgerTypeField.tsx"), "utf8");
const aiPanel = readFileSync(join(root, "src/components/LedgerAiSettingsPanel.tsx"), "utf8");
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

// Heuristic: ส่งเครื่องซ่อม must not be asset
assert.match(labels, /ส่งเครื่อง/);
assert.match(labels, /ซ่อม/);

// UI wiring
assert.match(ledgerPage, /LedgerAiSettingsPanel/);
assert.match(ledgerPage, /LedgerTypeField/);
assert.match(ledgerPage, /useLedgerAiClassify/);
assert.match(ledgerPage, /typeSource/);
assert.match(typeField, /จัดประเภทบัญชีโดย AI/);
assert.match(aiPanel, /ตั้งค่า AI จัดประเภทบัญชี/);
assert.match(rules, /aiSettings/);
assert.match(version, /APP_BUILD = 188/);

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

const milkType = await liveClassify("นมสดแม็คโคร");
assert.ok(["cogs", "sga"].includes(milkType), `milk got ${milkType}`);

console.log("OK test-ledger-ai-classify");
