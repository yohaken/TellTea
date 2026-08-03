/**
 * HTTP F4 — AI วางร่างยอดเดลิเวอรี่ลง L3 (vatDeliveryMonthProposals)
 * Auth: Bearer token เดียวกับ vatMailAgentDump (meta/vatAgentApi)
 * ไม่เขียน vatMonthlyReturns (L4) — ให้ owner ยืนยัน F5 บนเว็บ
 *
 * POST https://…/vatMailAgentPropose
 * Body: {
 *   monthKey: "2026-07",
 *   channels: {
 *     grab?: {
 *       appSales?, transfer?, gpExVat?, gpVat?, driveFileIds?, note?,
 *       days?: [{ dateKey, appSales, transfer, gpExVat?, gpVat? }]  // 4 คอลัมน์รายวัน
 *     },
 *     lineman?: …, shopee?: …
 *   }
 * }
 * คอลัมน์คงที่: ยอดขายแอพ · ยอดโอน · คชจ.GP · VAT-ซื้อ — AI/ระบบเติม · owner ซุ่มตรวจ
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

const REGION = "asia-southeast1";
const AGENT_API_DOC = "meta/vatAgentApi";
const PROPOSALS_COL = "vatDeliveryMonthProposals";
const CHANNELS = ["grab", "lineman", "shopee"];

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function extractToken(req) {
  const auth = String(req.get("authorization") || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  if (req.query && req.query.token) return String(req.query.token).trim();
  if (req.body && typeof req.body === "object" && req.body.token) {
    return String(req.body.token).trim();
  }
  return "";
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function emptyChannel(channel) {
  return {
    channel,
    status: "empty",
    strategy: "unknown",
    reportIds: [],
    skipIds: [],
    tagCounts: {},
    dayCount: 0,
    amounts: { appSales: null, transfer: null, gpExVat: null, gpVat: null },
    amountsSource: "none",
    note: "",
    driveFileIds: [],
    days: {},
  };
}

function feeParts(gross, net) {
  const fee = Math.max(0, Math.round((Number(gross) - Number(net)) * 100) / 100);
  const gpVat = fee > 0 ? Math.round(((fee * 7) / 107) * 100) / 100 : 0;
  const gpExVat = fee > 0 ? Math.round((fee - gpVat) * 100) / 100 : 0;
  return { gpExVat, gpVat };
}

function mapDays(rawDays) {
  const out = {};
  if (!Array.isArray(rawDays)) return out;
  for (const row of rawDays) {
    if (!row || typeof row !== "object") continue;
    const dateKey = asString(row.dateKey, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const appSales = numOrNull(row.appSales);
    const transfer = numOrNull(row.transfer);
    let gpExVat = numOrNull(row.gpExVat);
    let gpVat = numOrNull(row.gpVat);
    if (gpExVat == null && gpVat == null && appSales != null && transfer != null) {
      const p = feeParts(appSales, transfer);
      gpExVat = p.gpExVat;
      gpVat = p.gpVat;
    }
    const ok = (appSales != null && appSales > 0) || (transfer != null && transfer > 0);
    out[dateKey] = {
      dateKey,
      appSales: ok ? appSales : null,
      transfer: ok ? transfer ?? 0 : null,
      gpExVat: ok ? gpExVat ?? 0 : null,
      gpVat: ok ? gpVat ?? 0 : null,
      reportId: asString(row.reportId, 120),
      status: ok ? "ซุ่มตรวจ" : "gap",
    };
  }
  return out;
}

function rollupDays(days) {
  let appSales = 0;
  let transfer = 0;
  let gpExVat = 0;
  let gpVat = 0;
  let filled = 0;
  for (const d of Object.values(days || {})) {
    if (d.status === "gap") continue;
    if (!(Number(d.appSales) > 0 || Number(d.transfer) > 0)) continue;
    filled += 1;
    appSales += Number(d.appSales) || 0;
    transfer += Number(d.transfer) || 0;
    gpExVat += Number(d.gpExVat) || 0;
    gpVat += Number(d.gpVat) || 0;
  }
  if (!filled) return null;
  if (gpExVat <= 0 && gpVat <= 0 && appSales >= transfer) {
    const p = feeParts(appSales, transfer);
    gpExVat = p.gpExVat;
    gpVat = p.gpVat;
  }
  return {
    appSales: Math.round(appSales * 100) / 100,
    transfer: Math.round(transfer * 100) / 100,
    gpExVat: Math.round(gpExVat * 100) / 100,
    gpVat: Math.round(gpVat * 100) / 100,
    filled,
  };
}

function emptyProposal(monthKey) {
  return {
    monthKey,
    phase: "F4",
    status: "studying",
    channels: {
      grab: emptyChannel("grab"),
      lineman: emptyChannel("lineman"),
      shopee: emptyChannel("shopee"),
    },
    rebuiltAt: 0,
    rebuiltBy: "",
    catalogReportCount: 0,
  };
}

function applyDraft(proposal, drafts, actor) {
  const next = {
    ...proposal,
    phase: "F4",
    channels: { ...proposal.channels },
    rebuiltAt: Date.now(),
    rebuiltBy: actor,
  };
  for (const ch of CHANNELS) {
    const d = drafts[ch];
    if (!d || typeof d !== "object") continue;
    const prev = proposal.channels[ch] || emptyChannel(ch);
    const dayMap = Array.isArray(d.days) && d.days.length ? mapDays(d.days) : prev.days || {};
    const fromDays = Object.keys(dayMap).length ? rollupDays(dayMap) : null;
    let appSales = fromDays ? fromDays.appSales : numOrNull(d.appSales);
    let transfer = fromDays ? fromDays.transfer : numOrNull(d.transfer);
    let gpExVat = fromDays ? fromDays.gpExVat : numOrNull(d.gpExVat);
    let gpVat = fromDays ? fromDays.gpVat : numOrNull(d.gpVat);
    if (
      gpExVat == null &&
      gpVat == null &&
      appSales != null &&
      transfer != null &&
      appSales >= transfer
    ) {
      const p = feeParts(appSales, transfer);
      gpVat = p.gpVat;
      gpExVat = p.gpExVat;
    }
    const has = appSales != null && appSales > 0;
    const dayCount = Object.keys(dayMap).length;
    next.channels[ch] = {
      ...prev,
      days: dayMap,
      dayCount: dayCount || prev.dayCount || 0,
      amounts: has
        ? {
            appSales,
            transfer: transfer ?? 0,
            gpExVat: gpExVat ?? 0,
            gpVat: gpVat ?? 0,
          }
        : prev.amounts || emptyChannel(ch).amounts,
      amountsSource: has ? "drive-ai" : prev.amountsSource || "none",
      status: has ? "ready" : prev.status,
      driveFileIds: Array.isArray(d.driveFileIds)
        ? d.driveFileIds.map(String).filter(Boolean).slice(0, 40)
        : prev.driveFileIds || [],
      note: has
        ? asString(
            d.note ||
              (dayCount
                ? `F4 จากตารางรายวัน ${fromDays?.filled || dayCount} วัน · AI adapter · รอซุ่มตรวจ · ยังไม่ทับงบ`
                : "F4 จาก Agent · รอซุ่มตรวจ · ยังไม่ทับงบ"),
            400,
          )
        : asString(d.note || prev.note || "", 400),
    };
  }
  const anyReady = CHANNELS.some((ch) => {
    const c = next.channels[ch];
    return (
      (c.amountsSource === "drive-ai" ||
        c.amountsSource === "adapter" ||
        c.amountsSource === "manual") &&
      c.amounts &&
      Number(c.amounts.appSales) > 0
    );
  });
  next.status = anyReady ? "ready" : "studying";
  return next;
}

exports.vatMailAgentPropose = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "POST only" });
      return;
    }

    try {
      const token = extractToken(req);
      if (!token || token.length < 16) {
        res.status(401).json({ ok: false, error: "missing token" });
        return;
      }

      const db = getFirestore();
      const apiSnap = await db.doc(AGENT_API_DOC).get();
      if (!apiSnap.exists || !apiSnap.get("token")) {
        res.status(403).json({ ok: false, error: "agent API not configured" });
        return;
      }
      const expected = String(apiSnap.get("token") || "");
      if (!timingSafeEqualStr(token, expected)) {
        res.status(403).json({ ok: false, error: "invalid token" });
        return;
      }
      if (apiSnap.get("enabled") === false) {
        res.status(403).json({ ok: false, error: "agent API disabled" });
        return;
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const monthKey = asString(body.monthKey, 10);
      if (!/^\d{4}-\d{2}$/.test(monthKey)) {
        res.status(400).json({ ok: false, error: "monthKey must be YYYY-MM" });
        return;
      }
      const channelsIn =
        body.channels && typeof body.channels === "object" ? body.channels : null;
      if (!channelsIn) {
        res.status(400).json({ ok: false, error: "channels required" });
        return;
      }

      // กันเขียน L4 โดยตรง
      if (body.vatMonthlyReturns || body.writeBooks || body.mergeBooks) {
        res.status(400).json({
          ok: false,
          error: "F4 must not write books — owner confirms F5 on web",
        });
        return;
      }

      const snap = await db.collection(PROPOSALS_COL).doc(monthKey).get();
      const prev = snap.exists
        ? { ...emptyProposal(monthKey), ...(snap.data() || {}), monthKey }
        : emptyProposal(monthKey);
      // normalize nested channels
      const base = emptyProposal(monthKey);
      for (const ch of CHANNELS) {
        base.channels[ch] = {
          ...emptyChannel(ch),
          ...(prev.channels && prev.channels[ch] ? prev.channels[ch] : {}),
          channel: ch,
        };
      }
      base.catalogReportCount = Number(prev.catalogReportCount) || 0;

      const next = applyDraft(base, channelsIn, "vatMailAgentPropose");
      await db.collection(PROPOSALS_COL).doc(monthKey).set(next, { merge: true });

      await db.doc(AGENT_API_DOC).set(
        {
          lastUsedAt: Date.now(),
          lastUsedBy: "vatMailAgentPropose",
        },
        { merge: true },
      );

      const ready = CHANNELS.filter((ch) => {
        const c = next.channels[ch];
        return c.amountsSource === "drive-ai" && Number(c.amounts?.appSales) > 0;
      });

      res.status(200).json({
        ok: true,
        monthKey,
        phase: "F4",
        status: next.status,
        readyChannels: ready,
        channels: Object.fromEntries(
          CHANNELS.map((ch) => [
            ch,
            {
              amounts: next.channels[ch].amounts,
              amountsSource: next.channels[ch].amountsSource,
              note: next.channels[ch].note,
              driveFileIds: next.channels[ch].driveFileIds || [],
              dayCount: Object.keys(next.channels[ch].days || {}).length,
              days: next.channels[ch].days || {},
            },
          ]),
        ),
        hint:
          "คอลัมน์: ยอดขายแอพ·ยอดโอน·คชจ.GP·VAT-ซื้อ · ส่ง days[] ได้เมื่อไม่มีสรุปเดือน · Owner ซุ่มตรวจแล้วกด F5 — ไม่เขียนงบอัตโนมัติ",
      });
    } catch (e) {
      console.error("vatMailAgentPropose", e);
      res.status(500).json({
        ok: false,
        error: asString(e?.message || String(e), 200),
      });
    }
  });
