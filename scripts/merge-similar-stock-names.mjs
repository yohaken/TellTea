/**
 * รวมชื่อคลังที่น่าจะเป็นรายการเดียวกัน (OCR สะกดเพี้ยนเล็กน้อย)
 * — เฉพาะแถบไม่นับ (แค็ตตาล็อกจากบิล)
 * — คงตัวหลัก 1 · ชื่ออื่นเป็น aliases · ลบเอกสารซ้ำ
 * — ย้าย stockCosts / แก้ menuSopCosts.ingredientLinks ที่ชี้ id เก่า
 *
 * Usage:
 *   node scripts/merge-similar-stock-names.mjs [--dry]
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: "mypeer-501909",
  });
}
const db = admin.firestore();
const dry = process.argv.includes("--dry");

/** ลดเสียง OCR / แพ็ค / วรรณยุกต์ใกล้เคียง */
function normalizeForCluster(raw) {
  let s = String(raw || "")
    .trim()
    .toLowerCase();
  // ตัด prefix แพ็ค/หีบ
  s = s.replace(/^(หีบ|หีม|แพ็ค|กระสอบ)\s*\*?\s*\d+\s*/i, "");
  s = s.replace(/\(\s*หีบ\s*\*?\s*\d+\s*\)/gi, "");
  s = s.replace(/\d+\s*(กรัม|ก\.|กก\.|กิโลกรัม|มล\.|ลิตร|ล\.|ชิ้น|g|kg|ml)\.?/gi, "");
  s = s.replace(/\d{2,4}\s*g\.?/gi, "");
  // OCR ใกล้เคียง
  const pairs = [
    [/ติ่งฟ่ง/g, "ติ่งฟง"],
    [/ติ๊งฟง/g, "ติ่งฟง"],
    [/ติ๊งฟ่ง/g, "ติ่งฟง"],
    [/คาร์เนชั่น/g, "คาร์เนชัน"],
    [/คาร์เนชั่น/g, "คาร์เนชัน"],
    [/เอ็กซ์ตร้า/g, "เอ็กซ์ตร้า"],
    [/เอ๊กซ์ตร้า/g, "เอ็กซ์ตร้า"],
    [/เล็กช์ตร้า/g, "เอ็กซ์ตร้า"],
    [/บราวน์ชูการ์/g, "บราวน์ซูการ์"],
    [/บราวน์ซูการ์/g, "บราวน์ซูการ์"],
    [/ดอฟฟี่/g, "คอฟฟี่"],
    [/ดรัมมี่/g, "ดรีมมี่"],
    [/ดัชม์/g, "ดรีมมี่"],
    [/ดัสมี่/g, "ดรีมมี่"],
    [/แจ๊ค/g, "แจ็ค"],
    [/กะโหลก/g, "กระโหลก"],
    [/พัฟทอป/g, "พัฟท็อป"],
    [/ว่าว/g, "วาว"],
    [/ตราวาว/g, "ตราว่าว"],
    [/โยโก/g, "โยกุ"],
    [/โยคุ/g, "โยกุ"],
    [/โบกุ/g, "โยกุ"],
    [/โนกุ/g, "โยกุ"],
    [/ตรามือน/g, "ตรามือ"],
    [/เมาเทิน|เมนเทิน|เมนเทน|เม้าเท็น/g, "เมาเทิน"],
    [/ร็อค\s*เมาเทิน/g, "ร็อคเมาเทิน"],
    [/เซฟแพ็ค|เชฟแพ็ค/g, "เซฟแพ็ค"],
    [/สตรอว์เบอร์รี|สตรอว์เบอร์รี่|สตรอเบอร์รี่/g, "สตรอเบอร์รี่"],
    [/มิกซ์เบอร์รี|มิกซ์เบอร์รี่/g, "มิกซ์เบอร์รี่"],
    [/ดัชชี่|ดัชมิลล์/g, "ดัชมิลล์"],
    [/เบสท์ฟู้ดส์|เบสฟู้ดส์/g, "เบสท์ฟู้ดส์"],
    [/จูนิเมอร์/g, "จูนิเปอร์"],
    [/คอมพาร์ด/g, "คอมพาวด์"],
    [/มาจิคสกิน|มาจีคลีน/g, "มาจีคลีน"],
    [/เปรย์|เรย์/g, "เรย์"],
    [/นมสตาร์เนชั่น/g, "นมสดคาร์เนชัน"],
    [/ซันดริก/g, "ซันควิก"],
  ];
  for (const [re, to] of pairs) s = s.replace(re, to);
  // ตัดวรรณยุกต์ไทยเพื่อจับคู่หลวม
  s = s.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "");
  s = s.replace(/[^0-9a-z\u0E00-\u0E7F]+/g, "");
  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

const FLAVOR_RE =
  /พีช|ลิ้นจี่|ฟรุต\s*พ?ั้นช์|ฟรุตพั้นช์|องุ่น|เมล่อน|สละ|sala|น้ำผึ้งมะนาว|น้ำผึ้ง|มะนาว|คาราเมล|มิ้นท์|เฮเซล|ช็อกโกแลต|ช็อก|สตรอเบอร์รี?|มะม่วง|บลูฮาวาย|บลูเบอร์รี?|แอปเปิ้ล|เสาวรส|บราวน์|เผือก|มันม่วง|วานิลลา|กาแฟ|ชาเขียว|ชาไทย/gi;

function flavorSet(name) {
  const s = new Set();
  const n = String(name || "");
  for (const m of n.matchAll(FLAVOR_RE)) {
    s.add(m[0].replace(/\s+/g, "").toLowerCase());
  }
  return s;
}

function flavorsConflict(nameA, nameB) {
  const a = flavorSet(nameA);
  const b = flavorSet(nameB);
  if (!a.size || !b.size) return false;
  for (const x of a) if (b.has(x)) return false;
  return true; // ทั้งคู่มีรส แต่ไม่ซ้อนกัน = คนละสินค้า
}

function similar(keyA, keyB, nameA, nameB) {
  if (!keyA || !keyB) return false;
  if (flavorsConflict(nameA, nameB)) return false;
  if (keyA === keyB) return true;
  if (keyA.includes(keyB) || keyB.includes(keyA)) {
    const ratio = Math.min(keyA.length, keyB.length) / Math.max(keyA.length, keyB.length);
    return ratio >= 0.78;
  }
  const dist = levenshtein(keyA, keyB);
  const maxLen = Math.max(keyA.length, keyB.length);
  if (maxLen <= 6) return dist <= 1;
  if (maxLen <= 12) return dist <= 2;
  return dist / maxLen <= 0.15;
}

/** เลือกชื่อหลัก: สั้น สะอาด ไม่มีหีบ* / ตัวเลขแพ็ค / สะกด OCR แปลก */
function scoreCanonical(name) {
  let s = 0;
  const n = String(name || "");
  if (/^(หีบ|หีม|แพ็ค|กระสอบ)/i.test(n)) s -= 50;
  if (/\d{3,}/.test(n)) s -= 5;
  if (/\(หีบ/i.test(n)) s -= 20;
  if (/ดอฟฟี่|เล็กช์ตร้า|ติ่งฟ่ง|ตรามือน|นมสตาร์|กะโหลก|จูนิเมอร์|ดรัมมี่|ดัชม์|ซันดริก|เมนเทน|เมนเทิน|เม้าเท็น|บราวน์ชูการ์/i.test(n))
    s -= 25;
  if (/คอฟฟี่|เอ็กซ์ตร้า|ติ่งฟง|ตรามือ|กระโหลก|จูนิเปอร์|ดรีมมี่|ซันควิก|เมาเทิน|บราวน์ซูการ์/i.test(n)) s += 15;
  if (n.length >= 6 && n.length <= 40) s += 10;
  s -= Math.max(0, n.length - 40) * 0.5;
  return s;
}

function clusterItems(items) {
  const withKey = items.map((it) => ({
    ...it,
    key: normalizeForCluster(it.name),
  }));
  const used = new Set();
  const clusters = [];
  for (let i = 0; i < withKey.length; i++) {
    if (used.has(withKey[i].id)) continue;
    const group = [withKey[i]];
    used.add(withKey[i].id);
    for (let j = i + 1; j < withKey.length; j++) {
      if (used.has(withKey[j].id)) continue;
      if (similar(withKey[i].key, withKey[j].key, withKey[i].name, withKey[j].name)) {
        group.push(withKey[j]);
        used.add(withKey[j].id);
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < withKey.length; j++) {
        if (used.has(withKey[j].id)) continue;
        if (
          group.some((g) =>
            similar(g.key, withKey[j].key, g.name, withKey[j].name),
          )
        ) {
          group.push(withKey[j]);
          used.add(withKey[j].id);
          grew = true;
        }
      }
    }
    clusters.push(group);
  }
  return clusters.filter((c) => c.length > 1);
}

async function rewriteMenuSopLinks(idMap) {
  if (!idMap.size) return 0;
  const snap = await db.collection("menuSopCosts").get();
  let patched = 0;
  for (const d of snap.docs) {
    const links = Array.isArray(d.data()?.ingredientLinks)
      ? d.data().ingredientLinks
      : [];
    let changed = false;
    const next = links.map((l) => {
      const sid = String(l?.stockItemId || "");
      if (sid && idMap.has(sid)) {
        changed = true;
        return { ...l, stockItemId: idMap.get(sid) };
      }
      return l;
    });
    if (changed) {
      if (!dry) {
        await d.ref.set({ ingredientLinks: next, updatedAt: Date.now() }, { merge: true });
      }
      patched += 1;
    }
  }
  return patched;
}

async function moveCost(fromId, toId) {
  const from = await db.doc(`stockCosts/${fromId}`).get();
  if (!from.exists) return;
  const data = from.data() || {};
  const to = await db.doc(`stockCosts/${toId}`).get();
  if (!to.exists) {
    if (!dry) await db.doc(`stockCosts/${toId}`).set({ ...data, updatedAt: Date.now() });
  } else {
    // คงของปลายทาง · ทิ้งต้นทาง
  }
  if (!dry) await db.doc(`stockCosts/${fromId}`).delete().catch(() => undefined);
}

async function main() {
  const snap = await db.collection("stock").get();
  const items = [];
  for (const d of snap.docs) {
    const x = d.data();
    if (x.includeInCount !== false) continue; // เฉพาะไม่นับ
    items.push({
      id: d.id,
      name: String(x.name || "").trim(),
      aliases: Array.isArray(x.aliases) ? x.aliases.map(String) : [],
      unit: String(x.unit || "ก."),
      note: String(x.note || ""),
      updatedAt: Number(x.updatedAt) || 0,
    });
  }

  const clusters = clusterItems(items);
  const idMap = new Map(); // old -> keep
  const report = [];

  for (const group of clusters) {
    group.sort((a, b) => scoreCanonical(b.name) - scoreCanonical(a.name));
    const keep = group[0];
    const drop = group.slice(1);
    const aliasSet = new Set([
      ...(keep.aliases || []),
      keep.name,
      ...drop.flatMap((d) => [d.name, ...(d.aliases || [])]),
    ]);
    aliasSet.delete(keep.name);
    const aliases = [...aliasSet].filter(Boolean).slice(0, 40);

    report.push({
      keep: keep.name,
      keepId: keep.id,
      merge: drop.map((d) => d.name),
      aliasesAdded: aliases.filter((a) => !(keep.aliases || []).includes(a)),
    });

    for (const d of drop) idMap.set(d.id, keep.id);

    if (!dry) {
      await db.doc(`stock/${keep.id}`).set(
        {
          aliases,
          note: keep.note || "รวมชื่อจากบิล · OCR ใกล้เคียง",
          updatedAt: Date.now(),
          updatedBy: "merge-similar-stock-names",
        },
        { merge: true },
      );
      for (const d of drop) {
        await moveCost(d.id, keep.id);
        await db.doc(`stock/${d.id}`).delete();
      }
    }
  }

  const sopPatched = await rewriteMenuSopLinks(idMap);

  console.log(
    JSON.stringify(
      {
        dry,
        scannedSkip: items.length,
        clusters: clusters.length,
        mergedAway: idMap.size,
        afterEstimate: items.length - idMap.size,
        sopCostsPatched: sopPatched,
        samples: report.slice(0, 40),
        all: report,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
