const { HttpsError } = require("firebase-functions/v1/https");

function startOfBangkokDay(now = Date.now()) {
  const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  local.setHours(0, 0, 0, 0);
  return local.getTime();
}

function formatBillNo(dateMs, seq) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(new Date(dateMs));
  const dd = parts.find((p) => p.type === "day")?.value || "01";
  const mm = parts.find((p) => p.type === "month")?.value || "01";
  return `P${dd}${mm}-${String(seq).padStart(3, "0")}`;
}

function isPosCaller(auth) {
  if (!auth?.uid) return false;
  const token = auth.token || {};
  if (token.posDevice === true) return true;
  return token.firebase?.sign_in_provider === "anonymous";
}

function parseLines(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines = raw.map((line) => {
    if (!line || typeof line !== "object") return null;
    const name = typeof line.name === "string" ? line.name.trim() : "";
    const menuItemId = typeof line.menuItemId === "string" ? line.menuItemId : "";
    const price = Number(line.price);
    const qty = Number(line.qty);
    if (!name || !menuItemId || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
      return null;
    }
    const out = { menuItemId, name, price, qty };
    if (Array.isArray(line.options) && line.options.length > 0) {
      const options = line.options
        .map((grp) => {
          if (!grp || typeof grp !== "object") return null;
          const groupId = typeof grp.groupId === "string" ? grp.groupId : "";
          const groupName = typeof grp.groupName === "string" ? grp.groupName : "";
          if (!groupId || !groupName || !Array.isArray(grp.choices)) return null;
          const choices = grp.choices
            .map((c) => {
              if (!c || typeof c !== "object") return null;
              const optionId = typeof c.optionId === "string" ? c.optionId : "";
              const cname = typeof c.name === "string" ? c.name : "";
              const priceDelta = Number(c.priceDelta);
              if (!optionId || !cname || !Number.isFinite(priceDelta) || priceDelta < 0) return null;
              return { optionId, name: cname, priceDelta };
            })
            .filter(Boolean);
          if (!choices.length) return null;
          return { groupId, groupName, choices };
        })
        .filter(Boolean);
      if (options.length) out.options = options;
    }
    return out;
  });
  return lines.every(Boolean) ? lines : null;
}

function parseMutationId(raw) {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (id.length < 8 || id.length > 128) return "";
  if (!/^[a-zA-Z0-9:_-]+$/.test(id)) return "";
  return id;
}

/**
 * Server-side POS sale — Admin SDK bypasses client Firestore rules.
 */
async function completePosSaleAdmin(db, data, uid) {
  const deviceId = uid;
  const clientMutationId = parseMutationId(data?.clientMutationId);
  if (typeof data?.deviceId !== "string" || data.deviceId !== deviceId) {
    throw new HttpsError("invalid-argument", "deviceId ไม่ตรงกับเครื่อง");
  }
  if (typeof data?.sessionId !== "string" || !data.sessionId) {
    throw new HttpsError("invalid-argument", "sessionId ไม่ถูกต้อง");
  }
  if (typeof data?.shift !== "string" || !data.shift) {
    throw new HttpsError("invalid-argument", "shift ไม่ถูกต้อง");
  }

  const lines = parseLines(data?.lines);
  if (!lines) {
    throw new HttpsError("invalid-argument", "ตะกร้าว่าง — เลือกเมนูก่อน");
  }

  const paymentMethod = data?.paymentMethod === "promptpay" ? "promptpay" : "cash";
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const total = Math.round(subtotal * 100) / 100;
  if (total <= 0) {
    throw new HttpsError("invalid-argument", "ยอดขายไม่ถูกต้อง");
  }

  let cashReceived = Math.round(Number(data?.cashReceived || 0) * 100) / 100;
  let change = 0;
  if (paymentMethod === "cash") {
    if (cashReceived < total) {
      throw new HttpsError("invalid-argument", "เงินที่รับน้อยกว่ายอดขาย");
    }
    change = Math.round((cashReceived - total) * 100) / 100;
  } else {
    cashReceived = 0;
  }

  const now = Date.now();
  const date = startOfBangkokDay(now);
  const createdBy = `pos:${deviceId}`;
  const saleRef = db.collection("posSales").doc();
  const metaPosRef = db.doc("meta/pos");
  const mutationRef = clientMutationId ? db.doc(`posSaleMutations/${clientMutationId}`) : null;

  const txResult = await db.runTransaction(async (tx) => {
    if (mutationRef) {
      const mutSnap = await tx.get(mutationRef);
      if (mutSnap.exists) {
        return { replay: mutSnap.data() || {} };
      }
    }

    const posSnap = await tx.get(metaPosRef);
    const posData = posSnap.data() || {};
    let seq = 1;
    if (posData.billDate === date && typeof posData.billSeq === "number") {
      seq = posData.billSeq + 1;
    }
    const nextBillNo = formatBillNo(date, seq);

    tx.set(metaPosRef, { billDate: date, billSeq: seq, updatedAt: now }, { merge: true });
    tx.set(saleRef, {
      billNo: nextBillNo,
      deviceId,
      sessionId: data.sessionId,
      date,
      shift: data.shift,
      lines,
      subtotal: total,
      total,
      paymentMethod,
      cashReceived,
      change,
      createdAt: now,
      createdBy,
      status: "completed",
      ...(clientMutationId ? { clientMutationId } : {}),
    });
    if (mutationRef) {
      tx.set(mutationRef, {
        saleId: saleRef.id,
        billNo: nextBillNo,
        change,
        total,
        deviceId,
        createdAt: now,
      });
    }

    return { billNo: nextBillNo };
  });

  if (txResult.replay) {
    const m = txResult.replay;
    return {
      saleId: typeof m.saleId === "string" ? m.saleId : saleRef.id,
      billNo: typeof m.billNo === "string" ? m.billNo : "—",
      change: Number(m.change) || 0,
      total: Number(m.total) || total,
      replayed: true,
    };
  }

  const billNo = txResult.billNo;

  const sessionRef = db.doc(`posSessions/${data.sessionId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) return;
    const session = snap.data() || {};
    if (session.deviceId !== deviceId || session.status !== "open") return;
    const saleCount = Math.max(0, (Number(session.saleCount) || 0) + 1);
    const totalSales = Math.max(
      0,
      Math.round(((Number(session.totalSales) || 0) + total) * 100) / 100,
    );
    tx.set(sessionRef, { saleCount, totalSales, updatedAt: now }, { merge: true });
  });

  return { saleId: saleRef.id, billNo, change, total };
}

module.exports = { completePosSaleAdmin, isPosCaller };
