/**
 * One-shot raw import: บช. เจ้าของ.xlsx → Firestore ownerBooks
 * Uses Firebase CLI refresh token (owner gcloud/firebase login).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const XLSX = require("xlsx");
const { UserRefreshClient } = require(path.join(
  __dirname,
  "..",
  "functions/node_modules/google-auth-library",
));

const PROJECT = "mypeer-501909";
const XLSX_PATH = path.join(__dirname, "..", "บช. เจ้าของ.xlsx");
const COLLECTION = "ownerBooks";
const META_DOC = "meta/ownerBooks";

/** Public Firebase CLI OAuth client (same as firebase-tools) */
const CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "jEPKHZAmENKqzdtSl33BhWDu";

function excelSerialToLocalMidnight(serial) {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) throw new Error(`bad date serial ${serial}`);
  return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerIndex = rows.findIndex((row) => {
    const cells = (row || []).map((c) => String(c ?? "").trim());
    return cells.includes("วันที่") && cells.includes("รายการ");
  });
  if (headerIndex < 0) throw new Error("header not found");

  const header = {};
  (rows[headerIndex] || []).forEach((cell, i) => {
    const key = String(cell ?? "").trim();
    if (key) header[key] = i;
  });
  const colDate = header["วันที่"];
  const colDesc = header["รายการ"];
  const colOut = header["ออก"];
  if (colDate == null || colDesc == null || colOut == null) {
    throw new Error("missing columns");
  }

  const parsed = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[colDesc] ?? "").trim();
    if (!description) continue;
    const amountOut = toNumber(row[colOut]);
    if (amountOut <= 0) continue;
    const rawDate = row[colDate];
    if (typeof rawDate !== "number") {
      throw new Error(`row ${i + 1}: bad date ${rawDate}`);
    }
    const typeRaw = row[colOut + 1];
    const type = typeof typeRaw === "string" ? typeRaw.trim() : "";
    parsed.push({
      date: excelSerialToLocalMidnight(rawDate),
      description,
      amountOut,
      type,
      sourceRow: i + 1,
    });
  }
  return parsed;
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
  if (access && expiresAt > Date.now() + 60_000) {
    return access;
  }
  const client = new UserRefreshClient(
    CLIENT_ID,
    CLIENT_SECRET,
    cfg.tokens.refresh_token,
  );
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token");
  return token;
}

function firestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  throw new Error(`unsupported ${typeof value}`);
}

function docFields(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = firestoreValue(v);
  }
  return fields;
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

async function listDocumentNames(token, collectionId) {
  const names = [];
  let pageToken = "";
  for (;;) {
    const qs = new URLSearchParams({ pageSize: "300" });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collectionId}?${qs}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`list ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = await res.json();
    for (const doc of json.documents || []) names.push(doc.name);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return names;
}

async function deleteAll(token) {
  const names = await listDocumentNames(token, COLLECTION);
  console.log(`deleting existing ${names.length} docs...`);
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    await commitWrites(
      token,
      chunk.map((name) => ({ delete: name })),
    );
    console.log(`  deleted ${Math.min(i + 200, names.length)}/${names.length}`);
  }
}

function randomId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`missing file: ${XLSX_PATH}`);
  }
  const rows = parseWorkbook(XLSX_PATH);
  const sumOut = rows.reduce((s, r) => s + r.amountOut, 0);
  console.log(`parsed ${rows.length} rows, sumOut=${sumOut}`);

  const token = await getAccessToken();
  console.log("got access token");

  await deleteAll(token);

  const base = Date.now();
  const createdBy = "yohaken@gmail.com";
  console.log(`writing ${rows.length} docs...`);

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const writes = chunk.map((row, j) => {
      const id = randomId();
      const name = `projects/${PROJECT}/databases/(default)/documents/${COLLECTION}/${id}`;
      return {
        update: {
          name,
          fields: docFields({
            date: row.date,
            description: row.description,
            amountIn: 0,
            amountOut: row.amountOut,
            type: row.type || "",
            createdBy,
            createdAt: base + i + j,
            receiptUrl: "",
          }),
        },
      };
    });
    await commitWrites(token, writes);
    console.log(`  wrote ${Math.min(i + 200, rows.length)}/${rows.length}`);
  }

  const metaName = `projects/${PROJECT}/databases/(default)/documents/${META_DOC}`;
  await commitWrites(token, [
    {
      update: {
        name: metaName,
        fields: docFields({
          totalOut: sumOut,
          balance: -sumOut,
          updatedAt: Date.now(),
        }),
      },
    },
  ]);
  console.log(`meta updated totalOut=${sumOut}`);
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
