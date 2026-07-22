/**
 * nPos sell bridge — menu / shop settings / session / complete sale
 * without Firebase Auth on the tablet (Admin SDK, installId as deviceId).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { completePosSaleAdmin, voidPosSaleAdmin } = require("./pos-complete-sale");

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === "object" ? body : null;
}

function requireInstallId(body) {
  const installId = asString(body?.installId, 64);
  if (!installId || installId.length < 8 || !/^[a-zA-Z0-9_-]+$/.test(installId)) {
    return null;
  }
  return installId;
}

function shiftFromHour(h) {
  if (h >= 0 && h < 6) return "late";
  if (h < 15) return "morning";
  return "evening";
}

function startOfBangkokDay(now = Date.now()) {
  const local = new Date(new Date(now).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  local.setHours(0, 0, 0, 0);
  return local.getTime();
}

exports.nposMenuSnapshot = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ ok: false, error: "POST or GET" });
    return;
  }
  try {
    const db = getFirestore();
    const [catsSnap, itemsSnap, groupsSnap] = await Promise.all([
      db.collection("menuCategories").get(),
      db.collection("menuItems").get(),
      db.collection("menuOptionGroups").get(),
    ]);

    const categories = catsSnap.docs
      .map((d) => {
        const x = d.data() || {};
        return {
          id: d.id,
          name: asString(x.name, 80) || d.id,
          sortOrder: typeof x.sortOrder === "number" ? x.sortOrder : 0,
          active: x.active !== false,
        };
      })
      .filter((c) => c.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const optionGroups = groupsSnap.docs.map((d) => {
      const x = d.data() || {};
      const options = Array.isArray(x.options)
        ? x.options
            .filter((o) => o && o.active !== false)
            .map((o) => ({
              id: asString(o.id, 64),
              name: asString(o.name, 80),
              priceDelta: Number(o.priceDelta) || 0,
              sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : 0,
              active: true,
            }))
            .filter((o) => o.id && o.name)
        : [];
      return {
        id: d.id,
        name: asString(x.name, 80) || d.id,
        required: x.required === true,
        selectionType: asString(x.selectionType, 20) || "single",
        minSelect: typeof x.minSelect === "number" ? x.minSelect : undefined,
        maxSelect: typeof x.maxSelect === "number" ? x.maxSelect : undefined,
        options,
        active: x.active !== false,
      };
    });

    const items = itemsSnap.docs
      .map((d) => {
        const x = d.data() || {};
        return {
          id: d.id,
          categoryId: asString(x.categoryId, 64),
          name: asString(x.name, 120) || d.id,
          price: Number(x.price) || 0,
          sortOrder: typeof x.sortOrder === "number" ? x.sortOrder : 0,
          active: x.active !== false,
          visibleOnPos: x.visibleOnPos !== false,
          recommended: x.recommended === true,
          optionGroupIds: Array.isArray(x.optionGroupIds)
            ? x.optionGroupIds.filter((id) => typeof id === "string").slice(0, 12)
            : [],
          // data:image/... from PosMenuItemEditor — may be large; keep under soft cap per item
          imageUrl: (() => {
            const u = typeof x.imageUrl === "string" ? x.imageUrl.trim() : "";
            if (!u) return "";
            if (u.length > 180000) return "";
            return u.slice(0, 180000);
          })(),
        };
      })
      // Include sold-out (active:false) so nPos can show “ของหมด” like web sell grid.
      .filter((i) => i.visibleOnPos)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    res.status(200).json({
      ok: true,
      fetchedAt: Date.now(),
      categories,
      items,
      optionGroups: optionGroups.filter((g) => g.active),
    });
  } catch (err) {
    console.error("nposMenuSnapshot", err);
    res.status(500).json({ ok: false, error: "menu_failed" });
  }
});

/** Toggle sold-out (active flag) — same semantics as web toggleMenuItemSoldOut. */
exports.nposToggleSoldOut = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  const itemId = asString(body?.itemId, 80);
  if (!installId || !itemId) {
    res.status(400).json({ ok: false, error: "installId_and_itemId_required" });
    return;
  }
  const soldOut = body.soldOut === true;
  try {
    const db = getFirestore();
    const ref = db.doc(`menuItems/${itemId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "item_not_found" });
      return;
    }
    await ref.set({ active: !soldOut, updatedAt: Date.now(), soldOutBy: installId }, { merge: true });
    res.status(200).json({ ok: true, itemId, active: !soldOut, soldOut });
  } catch (err) {
    console.error("nposToggleSoldOut", err);
    res.status(500).json({ ok: false, error: "toggle_failed" });
  }
});

exports.nposShopSettings = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  try {
    const db = getFirestore();
    const snap = await db.doc("meta/pos").get();
    const x = snap.exists ? snap.data() || {} : {};
    res.status(200).json({
      ok: true,
      shopName: asString(x.shopName || x.shopNameTh, 120) || "TellTea",
      shopAddress: asString(x.shopAddress, 200),
      shopPhone: asString(x.shopPhone, 40),
      promptPayId: asString(x.promptPayId, 32),
      autoPrintReceipt: x.autoPrintReceipt !== false,
      receiptFooterNote: asString(x.receiptFooterNote, 160),
      updatedAt: typeof x.shopSettingsUpdatedAt === "number" ? x.shopSettingsUpdatedAt : Date.now(),
    });
  } catch (err) {
    console.error("nposShopSettings", err);
    res.status(500).json({ ok: false, error: "settings_failed" });
  }
});

exports.nposSessionOpen = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  if (!installId) {
    res.status(400).json({ ok: false, error: "invalid installId" });
    return;
  }
  try {
    const db = getFirestore();
    const now = Date.now();
    const bangkokHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "numeric",
        hour12: false,
      }).format(new Date(now)),
    );
    const shift = asString(body.shift, 20) || shiftFromHour(bangkokHour);
    const sessionId = asString(body.sessionId, 80) || `${installId}_${now}`;
    await db.doc(`posSessions/${sessionId}`).set(
      {
        deviceId: installId,
        date: startOfBangkokDay(now),
        shift,
        openedAt: now,
        status: "open",
        saleCount: 0,
        totalSales: 0,
        updatedAt: now,
        source: "npos-telltea",
      },
      { merge: true },
    );
    res.status(200).json({ ok: true, sessionId, shift, openedAt: now });
  } catch (err) {
    console.error("nposSessionOpen", err);
    res.status(500).json({ ok: false, error: "session_open_failed" });
  }
});

exports.nposSessionClose = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  const sessionId = asString(body?.sessionId, 80);
  if (!installId || !sessionId) {
    res.status(400).json({ ok: false, error: "installId_and_sessionId_required" });
    return;
  }
  try {
    const db = getFirestore();
    const ref = db.doc(`posSessions/${sessionId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "session_not_found" });
      return;
    }
    const data = snap.data() || {};
    if (data.deviceId !== installId) {
      res.status(403).json({ ok: false, error: "device_mismatch" });
      return;
    }
    const now = Date.now();
    await ref.set(
      {
        status: "closed",
        closedAt: now,
        updatedAt: now,
        cashTotal: Number(body.cashTotal) || 0,
        promptpayTotal: Number(body.promptpayTotal) || 0,
        openingCash: Number(body.openingCash) || 0,
        closingCashCounted: Number(body.closingCashCounted) || 0,
        expectedCash: Number(body.expectedCash) || 0,
        cashDifference: Number(body.cashDifference) || 0,
        leaveFloat: Number(body.leaveFloat) || 0,
        discountTotal: Number(body.discountTotal) || 0,
        voidedCount: Number(body.voidedCount) || 0,
        saleCountLocal: Number(body.saleCount) || 0,
        discrepancyNote: String(body.discrepancyNote || "").slice(0, 240),
        discrepancyLabel: String(body.discrepancyLabel || "").slice(0, 40),
      },
      { merge: true },
    );
    res.status(200).json({
      ok: true,
      sessionId,
      saleCount: Number(data.saleCount) || 0,
      totalSales: Number(data.totalSales) || 0,
      closedAt: now,
    });
  } catch (err) {
    console.error("nposSessionClose", err);
    res.status(500).json({ ok: false, error: "session_close_failed" });
  }
});

exports.nposCompleteSale = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  if (!installId) {
    res.status(400).json({ ok: false, error: "invalid installId" });
    return;
  }
  try {
    const db = getFirestore();
    const payload = {
      clientMutationId: body.clientMutationId,
      deviceId: installId,
      sessionId: body.sessionId,
      shift: body.shift,
      lines: body.lines,
      paymentMethod: body.paymentMethod,
      cashReceived: body.cashReceived,
      discountBaht: body.discountBaht,
    };
    const result = await completePosSaleAdmin(db, payload, installId);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = err?.code || err?.httpErrorCode?.status || 400;
    const message = err?.message || String(err);
    console.error("nposCompleteSale", message);
    res.status(typeof code === "number" ? code : 400).json({
      ok: false,
      error: message,
    });
  }
});

/** Void a synced sale — Admin SDK, installId auth (mirrors BO voidPosSale). */
exports.nposVoidSale = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  if (!installId) {
    res.status(400).json({ ok: false, error: "invalid installId" });
    return;
  }
  try {
    const db = getFirestore();
    const result = await voidPosSaleAdmin(
      db,
      {
        clientMutationId: body.clientMutationId,
        saleId: body.saleId,
        reason: body.reason,
      },
      installId,
    );
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const fnCode = typeof err?.code === "string" ? err.code : "";
    let http = 400;
    if (fnCode === "not-found") http = 404;
    else if (fnCode === "permission-denied") http = 403;
    const message = err?.message || String(err);
    console.error("nposVoidSale", message);
    res.status(http).json({ ok: false, error: message, code: fnCode || undefined });
  }
});

/** Reorder menu categories — same sortOrder scheme as web reorderMenuCategories. */
exports.nposReorderCategories = functions.region("asia-southeast1").https.onRequest(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const body = parseBody(req);
  const installId = requireInstallId(body);
  const ids = Array.isArray(body?.categoryIds) ? body.categoryIds : [];
  if (!installId || ids.length === 0) {
    res.status(400).json({ ok: false, error: "installId_and_categoryIds_required" });
    return;
  }
  try {
    const db = getFirestore();
    const batch = db.batch();
    let n = 0;
    for (let i = 0; i < ids.length && i < 80; i++) {
      const id = asString(ids[i], 80);
      if (!id) continue;
      batch.set(
        db.doc(`menuCategories/${id}`),
        { sortOrder: (i + 1) * 1000, updatedAt: Date.now(), reorderedBy: installId },
        { merge: true },
      );
      n += 1;
    }
    if (n === 0) {
      res.status(400).json({ ok: false, error: "no_valid_ids" });
      return;
    }
    await batch.commit();
    res.status(200).json({ ok: true, count: n });
  } catch (err) {
    console.error("nposReorderCategories", err);
    res.status(500).json({ ok: false, error: "reorder_failed" });
  }
});
