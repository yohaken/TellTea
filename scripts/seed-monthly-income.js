/**
 * Seed monthlyIncome from owner's P&L spreadsheet (income column).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT = "mypeer-501909";

const INCOME = {
  "2025-06": 379132.68,
  "2025-07": 385610.33,
  "2025-08": 397333.33,
  "2025-09": 394409.75,
  "2025-10": 404177.0,
  "2025-11": 343890.0,
  "2025-12": 359136.52,
  "2026-01": 363392.75,
  "2026-02": 400576.72,
  "2026-03": 442926.85,
  "2026-04": 360455.26,
  "2026-05": 398402.86,
  "2026-06": 374039.12,
};

function firestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  throw new Error(`unsupported ${typeof value}`);
}

async function getAccessToken() {
  const cfg = JSON.parse(
    fs.readFileSync(
      path.join(os.homedir(), ".config/configstore/firebase-tools.json"),
      "utf8",
    ),
  );
  const access = cfg.tokens?.access_token;
  const expiresAt = cfg.tokens?.expires_at || 0;
  if (!access || expiresAt <= Date.now() + 60_000) {
    throw new Error("Firebase access token expired — run: npx firebase login");
  }
  return access;
}

async function commitWrites(token, writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`commit ${res.status}: ${text.slice(0, 500)}`);
  }
}

async function main() {
  const token = await getAccessToken();
  const updatedBy = "yohaken@gmail.com";
  const updatedAt = Date.now();
  const writes = Object.entries(INCOME).map(([month, income]) => ({
    update: {
      name: `projects/${PROJECT}/databases/(default)/documents/monthlyIncome/${month}`,
      fields: {
        month: firestoreValue(month),
        income: firestoreValue(income),
        updatedAt: firestoreValue(updatedAt),
        updatedBy: firestoreValue(updatedBy),
      },
    },
  }));
  await commitWrites(token, writes);
  console.log(`seeded ${writes.length} monthlyIncome docs`);
  console.log(INCOME);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
