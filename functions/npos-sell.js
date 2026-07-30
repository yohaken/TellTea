/**
 * nPos sell bridge — menu / shop settings / session / complete sale
 * without Firebase Auth on the tablet (Admin SDK, installId as deviceId).
 */
const functions = require("firebase-functions/v1");
const { getFirestore } = require("firebase-admin/firestore");
const { completePosSaleAdmin, voidPosSaleAdmin } = require("./pos-complete-sale");
const { assertNposDeviceAllowed } = require("./npos-device-gate");

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

async function rejectIfDeviceNotAllowed(db, installId, res) {
  const gate = await assertNposDeviceAllowed(db, installId);
  if (gate.ok) return null;
  res.status(403).json({
    ok: false,
    error: gate.error || "device_not_allowed",
    code: gate.code || "device_not_allowed",
    storeClaimRequired: gate.required,
    storeClaimed: gate.claimed,
  });
  return gate;
}

const { startOfBangkokDay } = require("./bangkok-day");

function shiftFromHour(h) {
  if (h >= 0 && h < 6) return "late";
  if (h < 15) return "morning";
  return "evening";
}

/** Mid-shift cash-drop lines from tablet close body — cap size for Firestore. */
function sanitizeCashDropNotes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const slice = raw.length > 50 ? raw.slice(raw.length - 50) : raw;
  for (const row of slice) {
    if (!row || typeof row !== "object") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      amount,
      reason: String(row.reason || "").trim().slice(0, 120),
      at: Number(row.at) > 0 ? Number(row.at) : 0,
    });
  }
  return out;
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
    const menuRank = require("./pos-menu-rank");
    const [catsSnap, itemsSnap, groupsSnap, rankPack] = await Promise.all([
      db.collection("menuCategories").get(),
      db.collection("menuItems").get(),
      db.collection("menuOptionGroups").get(),
      menuRank.loadOrRefreshRank(db),
    ]);

    let categories = catsSnap.docs
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
              ...(typeof o.deliveryPriceDelta === "number"
                ? { deliveryPriceDelta: Number(o.deliveryPriceDelta) || 0 }
                : {}),
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

    let items = itemsSnap.docs
      .map((d) => {
        const x = d.data() || {};
        return {
          id: d.id,
          categoryId: asString(x.categoryId, 64),
          name: asString(x.name, 120) || d.id,
          price: Number(x.price) || 0,
          ...(typeof x.deliveryPrice === "number" ? { deliveryPrice: Number(x.deliveryPrice) || 0 } : {}),
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

    const menuArrangeMode = rankPack.menuArrangeMode || "fix";
    const rank = rankPack.rank || { windowDays: 7, computedAt: 0, categories: [], items: [] };
    if (menuArrangeMode === "bestsellers") {
      const ordered = menuRank.applyBestsellersOrder(categories, items, rank);
      categories = ordered.categories;
      items = ordered.items;
    }

    let menuVersion = 0;
    try {
      const metaPos = await db.doc("meta/pos").get();
      const mv = metaPos.exists ? (metaPos.data() || {}).menuVersion : 0;
      const mvn = typeof mv === "number" ? mv : Number(mv);
      if (Number.isFinite(mvn) && mvn > 0) menuVersion = Math.round(mvn);
    } catch (_) {
      /* optional */
    }

    res.status(200).json({
      ok: true,
      fetchedAt: Date.now(),
      menuVersion,
      menuArrangeMode,
      windowDays: rankPack.windowDays || rank.windowDays || 7,
      rank,
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
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
    let brandLogo = "";
    try {
      const logoSnap = await db.doc("meta/brandLogo").get();
      const raw = logoSnap.exists ? String((logoSnap.data() || {}).dataUrl || "").trim() : "";
      // Cap payload so tablets stay snappy (logo is already shrunk in BO).
      if (raw && raw.length <= 120000) brandLogo = raw;
    } catch (_) {
      /* optional */
    }
    // Active employee roster for clock-in name picker (not OT shift table).
    let employees = [];
    try {
      const empSnap = await db.collection("employees").orderBy("name").limit(80).get();
      employees = empSnap.docs
        .map((doc) => {
          const d = doc.data() || {};
          if (d.active === false) return null;
          const name = asString(d.name, 80);
          if (!name) return null;
          return {
            id: doc.id,
            name,
            nickname: asString(d.nickname, 40),
          };
        })
        .filter(Boolean);
    } catch (empErr) {
      console.warn("nposShopSettings employees", empErr && empErr.message);
      employees = [];
    }
    res.status(200).json({
      ok: true,
      shopName: asString(x.shopName, 120) || "TellTea",
      shopNameTh: asString(x.shopNameTh, 120),
      shopAddress: asString(x.shopAddress, 200),
      shopPhone: asString(x.shopPhone, 40),
      promptPayId: asString(x.promptPayId, 32),
      autoPrintReceipt: x.autoPrintReceipt !== false,
      receiptStaffName: asString(x.receiptStaffName, 80) || "หน้าร้าน",
      receiptFooterNote: asString(x.receiptFooterNote, 160),
      brandLogo,
      employees,
      menuVersion:
        typeof x.menuVersion === "number" && x.menuVersion > 0
          ? Math.round(x.menuVersion)
          : 0,
      menuArrangeMode: x.menuArrangeMode === "bestsellers" ? "bestsellers" : "fix",
      bestsellerWindowDays:
        typeof x.bestsellerWindowDays === "number" && x.bestsellerWindowDays >= 7
          ? Math.min(14, Math.round(x.bestsellerWindowDays))
          : 7,
      storeClaimRequired:
        typeof x.storeClaimCodeHash === "string" &&
        x.storeClaimCodeHash.length >= 32 &&
        x.storeClaimRequired !== false,
      storeClaimCodeHash:
        typeof x.storeClaimCodeHash === "string" && x.storeClaimCodeHash.length >= 32
          ? x.storeClaimCodeHash
          : "",
      storeClaimUpdatedAt:
        typeof x.storeClaimUpdatedAt === "number" ? x.storeClaimUpdatedAt : 0,
      updatedAt: typeof x.shopSettingsUpdatedAt === "number" ? x.shopSettingsUpdatedAt : 0,
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
    const now = Date.now();
    const bangkokHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "numeric",
        hour12: false,
      }).format(new Date(now)),
    );
    const shift = asString(body.shift, 20) || shiftFromHour(bangkokHour);

    // Exclusive-seat handoff: resume an already-open server session (kick ≠ close).
    const openSnap = await db.collection("posSessions").where("status", "==", "open").limit(10).get();
    if (!openSnap.empty) {
      let best = null;
      openSnap.forEach((doc) => {
        const data = doc.data() || {};
        const openedAt = Number(data.openedAt) || 0;
        if (!best || openedAt > (Number(best.data.openedAt) || 0)) {
          best = { id: doc.id, ref: doc.ref, data };
        }
      });
      if (best) {
        const prevDevice = asString(best.data.deviceId, 64);
        const openedAt = Number(best.data.openedAt) || now;
        const correctDate = startOfBangkokDay(openedAt);
        await best.ref.set(
          {
            deviceId: installId,
            previousDeviceId: prevDevice && prevDevice !== installId ? prevDevice : best.data.previousDeviceId || "",
            resumedAt: now,
            updatedAt: now,
            // Repair legacy UTC-midnight date keys so BO today query matches.
            date: correctDate,
          },
          { merge: true },
        );
        res.status(200).json({
          ok: true,
          sessionId: best.id,
          shift: asString(best.data.shift, 20) || shift,
          openedAt: Number(best.data.openedAt) || now,
          resumed: true,
          openingCash: Number(best.data.openingCash) || 0,
          saleCount: Number(best.data.saleCount) || 0,
          totalSales: Number(best.data.totalSales) || 0,
          cashTotal: Number(best.data.cashTotal) || 0,
          promptpayTotal: Number(best.data.promptpayTotal) || 0,
          transferTotal: Number(best.data.transferTotal) || 0,
          voidedCount: Number(best.data.voidedCount) || 0,
          discountTotal: Number(best.data.discountTotal) || 0,
          openedByEmployeeId: asString(best.data.openedByEmployeeId, 64),
          openedByName: asString(best.data.openedByName, 80),
        });
        return;
      }
    }

    const requestedId = asString(body.sessionId, 80) || `${installId}_${now}`;
    const openingCash = Number(body.openingCash);
    const openedByEmployeeId = asString(body.openedByEmployeeId, 64);
    const openedByName = asString(body.openedByName, 80);

    // Never revive a BO-force / already-closed round via merge — tablet must settle then open new.
    if (requestedId) {
      const prevSnap = await db.doc(`posSessions/${requestedId}`).get();
      if (prevSnap.exists) {
        const prev = prevSnap.data() || {};
        if (asString(prev.status, 16) === "closed") {
          res.status(200).json({
            ok: false,
            error: "session_closed",
            code: "session_remote_closed",
            sessionId: requestedId,
            closeSource: asString(prev.closeSource, 40),
            closedAt: Number(prev.closedAt) || 0,
          });
          return;
        }
      }
    }

    const sessionId = requestedId || `${installId}_${now}`;
    const patch = {
      deviceId: installId,
      date: startOfBangkokDay(now),
      shift,
      openedAt: now,
      status: "open",
      saleCount: 0,
      totalSales: 0,
      openingCash: Number.isFinite(openingCash) && openingCash >= 0 ? openingCash : 0,
      updatedAt: now,
      source: "npos-telltea",
    };
    if (openedByName) {
      patch.openedByName = openedByName;
      patch.openedByEmployeeId = openedByEmployeeId || "";
    }
    await db.doc(`posSessions/${sessionId}`).set(patch, { merge: true });
    res.status(200).json({
      ok: true,
      sessionId,
      shift,
      openedAt: now,
      resumed: false,
      openedByName: openedByName || "",
      openedByEmployeeId: openedByEmployeeId || "",
    });
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
    const ref = db.doc(`posSessions/${sessionId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "session_not_found" });
      return;
    }
    const data = snap.data() || {};
    // Allow seat holder after handoff (deviceId reassigned on resume).
    if (data.deviceId && data.deviceId !== installId) {
      res.status(403).json({ ok: false, error: "device_mismatch" });
      return;
    }
    const now = Date.now();
    const openedAt = Number(data.openedAt) || now;
    const correctDate = startOfBangkokDay(openedAt);
    const alreadyClosed = asString(data.status, 16) === "closed";
    // Keep original BO force-close clock; tablet Z can still finalize cash fields.
    const closedAt = alreadyClosed && Number(data.closedAt) ? Number(data.closedAt) : now;
    const closingCashCounted = Number(body.closingCashCounted) || 0;
    const leaveFloat = Number(body.leaveFloat) || 0;
    const cashDropNotes = sanitizeCashDropNotes(body.cashDropNotes);
    const cashDropCountBody = Number(body.cashDropCount);
    const patch = {
      status: "closed",
      closedAt,
      updatedAt: now,
      // Keep BO date query aligned with open day (Bangkok).
      date: correctDate,
      cashTotal: Number(body.cashTotal) || 0,
      promptpayTotal: Number(body.promptpayTotal) || 0,
      transferTotal: Number(body.transferTotal) || 0,
      openingCash: Number(body.openingCash) || 0,
      closingCashCounted,
      expectedCash: Number(body.expectedCash) || 0,
      cashDifference: Number(body.cashDifference) || 0,
      leaveFloat,
      // Cash to remit upstairs = counted drawer − leave float for next round.
      remitAmount: Math.max(0, closingCashCounted - leaveFloat),
      discountTotal: Number(body.discountTotal) || 0,
      voidedCount: Number(body.voidedCount) || 0,
      saleCountLocal: Number(body.saleCount) || 0,
      discrepancyNote: String(body.discrepancyNote || "").slice(0, 240),
      discrepancyLabel: String(body.discrepancyLabel || "").slice(0, 40),
      cashOutTotal: Number(body.cashOutTotal) || 0,
      cashInTotal: Number(body.cashInTotal) || 0,
      cashDropCount: Number.isFinite(cashDropCountBody)
        ? Math.max(0, Math.round(cashDropCountBody))
        : cashDropNotes.length,
      cashDropNotes,
      cashBillCount: Math.max(0, Math.round(Number(body.cashBillCount) || 0)),
      promptpayBillCount: Math.max(0, Math.round(Number(body.promptpayBillCount) || 0)),
      transferBillCount: Math.max(0, Math.round(Number(body.transferBillCount) || 0)),
    };
    if (alreadyClosed) {
      patch.zFinalizedAt = now;
      patch.zFinalizedBy = installId;
    }
    await ref.set(patch, { merge: true });
    res.status(200).json({
      ok: true,
      sessionId,
      saleCount: Number(data.saleCount) || 0,
      totalSales: Number(data.totalSales) || 0,
      closedAt,
      date: correctDate,
      alreadyClosed,
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
    const payload = {
      clientMutationId: body.clientMutationId,
      deviceId: installId,
      sessionId: body.sessionId,
      shift: body.shift,
      lines: body.lines,
      paymentMethod: body.paymentMethod,
      cashReceived: body.cashReceived,
      discountBaht: body.discountBaht,
      transferRef: body.transferRef,
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
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
    if (await rejectIfDeviceNotAllowed(db, installId, res)) return;
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
