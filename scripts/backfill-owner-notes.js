/**
 * Backfill ownerBooks.note from บช. เจ้าของ.xlsx (note column).
 * Matches by date + description + amountOut; updates only empty/missing notes.
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

function matchKey(date, description, amountOut) {
  return `${date}|${description}|${Number(amountOut)}`;
}

function parseNotesFromWorkbook(filePath) {
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
  const colNote = header["note"] ?? header["Note"] ?? header["NOTE"];
  if (colDate == null || colDesc == null || colOut == null || colNote == null) {
    throw new Error("missing columns (need วันที่ รายการ ออก note)");
  }

  /** @type {Map<string, string[]>} */
  const notesByKey = new Map();
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const description = String(row[colDesc] ?? "").trim();
    if (!description) continue;
    const amountOut = toNumber(row[colOut]);
    if (amountOut <= 0) continue;
    const note = String(row[colNote] ?? "").trim();
    if (!note) continue;
    const rawDate = row[colDate];
    if (typeof rawDate !== "number") {
      throw new Error(`row ${i + 1}: bad date ${rawDate}`);
    }
    const date = excelSerialToLocalMidnight(rawDate);
    const key = matchKey(date, description, amountOut);
    const list = notesByKey.get(key) || [];
    list.push(note);
    notesByKey.set(key, list);
  }
  return notesByKey;
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
  if (access && expiresAt > Date.now() + 60_000) return access;
  const client = new UserRefreshClient(
    CLIENT_ID,
    CLIENT_SECRET,
    cfg.tokens.refresh_token,
  );
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token");
  return token;
}

function fieldNumber(fields, key) {
  const f = fields?.[key];
  if (!f) return 0;
  if (f.integerValue != null) return Number(f.integerValue);
  if (f.doubleValue != null) return Number(f.doubleValue);
  return 0;
}

function fieldString(fields, key) {
  return fields?.[key]?.stringValue || "";
}

async function listDocs(token) {
  const docs = [];
  let pageToken = "";
  for (;;) {
    const qs = new URLSearchParams({ pageSize: "300" });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${COLLECTION}?${qs}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`list ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const json = await res.json();
    for (const doc of json.documents || []) docs.push(doc);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return docs;
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
    throw new Error(`commit ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`missing ${XLSX_PATH}`);
  const notesByKey = parseNotesFromWorkbook(XLSX_PATH);
  const noteRows = [...notesByKey.values()].reduce((n, a) => n + a.length, 0);
  console.log(`excel notes: ${noteRows} across ${notesByKey.size} keys`);

  const token = await getAccessToken();
  const docs = await listDocs(token);
  console.log(`firestore docs: ${docs.length}`);

  /** @type {Map<string, typeof docs>} */
  const docsByKey = new Map();
  for (const doc of docs) {
    const f = doc.fields || {};
    const key = matchKey(
      fieldNumber(f, "date"),
      fieldString(f, "description"),
      fieldNumber(f, "amountOut"),
    );
    const list = docsByKey.get(key) || [];
    list.push(doc);
    docsByKey.set(key, list);
  }

  const updates = [];
  let matched = 0;
  let skippedHasNote = 0;
  let missing = 0;

  for (const [key, notes] of notesByKey) {
    const candidates = docsByKey.get(key) || [];
    if (!candidates.length) {
      missing += notes.length;
      console.warn(`no match: ${key} note=${notes[0]}`);
      continue;
    }
    // Pair notes to docs in order; prefer docs with empty note
    const emptyFirst = [...candidates].sort((a, b) => {
      const an = fieldString(a.fields, "note") ? 1 : 0;
      const bn = fieldString(b.fields, "note") ? 1 : 0;
      return an - bn;
    });
    for (let i = 0; i < notes.length; i += 1) {
      const doc = emptyFirst[i];
      if (!doc) {
        missing += 1;
        continue;
      }
      const existing = fieldString(doc.fields, "note");
      if (existing) {
        skippedHasNote += 1;
        continue;
      }
      matched += 1;
      updates.push({
        update: {
          name: doc.name,
          fields: {
            note: { stringValue: notes[i] },
            updatedAt: { integerValue: String(Date.now()) },
          },
        },
        updateMask: { fieldPaths: ["note", "updatedAt"] },
      });
    }
  }

  console.log({ matched, skippedHasNote, missing, updates: updates.length });

  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    await commitWrites(token, chunk);
    console.log(`  updated ${Math.min(i + 200, updates.length)}/${updates.length}`);
  }
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
