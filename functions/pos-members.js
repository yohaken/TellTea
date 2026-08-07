/**
 * POS / public membership helpers (Admin SDK).
 * Earn/redeem must never break sales that omit member fields.
 */

function asString(v, max = 200) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/** Thai mobile → digits without + (e.g. 66812345678) */
function phoneDigitsFromInput(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("66")) {
    /* keep */
  } else if (digits.startsWith("0")) {
    digits = `66${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `66${digits}`;
  } else {
    return "";
  }
  if (digits.length < 10 || digits.length > 12) return "";
  return digits;
}

function phoneE164(digits) {
  return digits ? `+${digits}` : "";
}

function formatPhoneDisplay(digits) {
  if (digits.startsWith("66") && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

function cardNoFromDigits(digits) {
  const tail = digits.replace(/\D/g, "").slice(-8);
  return `TT${tail.padStart(8, "0")}`;
}

function normalizeMemberId(raw) {
  const s = asString(raw, 32);
  if (!s) return "";
  if (/^\d{10,12}$/.test(s)) return s;
  return phoneDigitsFromInput(s);
}

async function loadMemberSettings(db) {
  const snap = await db.doc("meta/memberSettings").get();
  const d = snap.exists ? snap.data() || {} : {};
  return {
    // Default OFF when doc missing — live counters stay unchanged until owner enables.
    enabled: d.enabled === true,
    bahtPerPoint:
      typeof d.bahtPerPoint === "number" && d.bahtPerPoint > 0 ? d.bahtPerPoint : 25,
    pointsPerBahtRedeem:
      typeof d.pointsPerBahtRedeem === "number" && d.pointsPerBahtRedeem > 0
        ? d.pointsPerBahtRedeem
        : 1,
    signupBonusPoints:
      typeof d.signupBonusPoints === "number" && d.signupBonusPoints >= 0
        ? Math.floor(d.signupBonusPoints)
        : 0,
    publicSignupEnabled: d.publicSignupEnabled === true,
    publicSignupToken: typeof d.publicSignupToken === "string" ? d.publicSignupToken : "",
  };
}

function pointsFromSaleAmount(amountBaht, settings) {
  if (!settings?.enabled || !(settings.bahtPerPoint > 0)) return 0;
  if (!(amountBaht > 0)) return 0;
  return Math.floor(amountBaht / settings.bahtPerPoint);
}

function redeemBahtFromPoints(points, settings) {
  if (!settings?.enabled || !(settings.pointsPerBahtRedeem > 0)) return 0;
  const p = Math.trunc(Number(points) || 0);
  if (p <= 0) return 0;
  return Math.floor(p / settings.pointsPerBahtRedeem);
}

async function ledgerExistsForSale(db, saleId, reason) {
  if (!saleId) return false;
  const snap = await db
    .collection("memberLedger")
    .where("saleId", "==", saleId)
    .where("reason", "==", reason)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Post-commit earn — never throws to caller (logs only).
 * Idempotent per saleId + earn_sale.
 */
async function tryEarnPointsForSale(db, { saleId, memberId, total, actorId }) {
  try {
    const mid = normalizeMemberId(memberId);
    if (!saleId || !mid) return { ok: false, skipped: "no_member" };
    const settings = await loadMemberSettings(db);
    if (!settings.enabled) return { ok: false, skipped: "disabled" };
    const points = pointsFromSaleAmount(Number(total) || 0, settings);
    if (points <= 0) return { ok: false, skipped: "zero_points" };
    if (await ledgerExistsForSale(db, saleId, "earn_sale")) {
      return { ok: true, skipped: "already_earned", points: 0 };
    }

    const memberRef = db.collection("members").doc(mid);
    const ledgerRef = db.collection("memberLedger").doc();
    const saleRef = db.collection("posSales").doc(saleId);
    const now = Date.now();

    const result = await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(memberRef);
      if (!mSnap.exists) return { skipped: "missing_member" };
      const m = mSnap.data() || {};
      if (m.status === "suspended") return { skipped: "suspended" };
      const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
      const lifetime = typeof m.lifetimePointsEarned === "number" ? m.lifetimePointsEarned : 0;
      const balanceAfter = balance + points;
      tx.update(memberRef, {
        pointsBalance: balanceAfter,
        lifetimePointsEarned: lifetime + points,
        updatedAt: now,
        updatedBy: actorId || "pos",
      });
      tx.set(ledgerRef, {
        memberId: mid,
        delta: points,
        balanceAfter,
        reason: "earn_sale",
        saleId,
        note: "",
        actorType: "system",
        actorId: actorId || "pos",
        createdAt: now,
      });
      tx.set(saleRef, { pointsEarned: points, memberId: mid }, { merge: true });
      return { points, balanceAfter };
    });

    if (result.skipped) return { ok: false, skipped: result.skipped };
    return { ok: true, points: result.points, balanceAfter: result.balanceAfter };
  } catch (err) {
    console.error("tryEarnPointsForSale", err && err.message);
    return { ok: false, error: String(err && err.message) };
  }
}

/**
 * Reverse earn on void — best-effort, never blocks void response.
 */
async function tryReverseEarnForVoid(db, { saleId, actorId }) {
  try {
    if (!saleId) return { ok: false, skipped: "no_sale" };
    if (await ledgerExistsForSale(db, saleId, "void_reverse")) {
      return { ok: true, skipped: "already_reversed" };
    }
    const earnSnap = await db
      .collection("memberLedger")
      .where("saleId", "==", saleId)
      .where("reason", "==", "earn_sale")
      .limit(1)
      .get();
    if (earnSnap.empty) return { ok: false, skipped: "no_earn" };
    const earn = earnSnap.docs[0].data() || {};
    const mid = asString(earn.memberId, 32);
    const points = Math.trunc(Number(earn.delta) || 0);
    if (!mid || points <= 0) return { ok: false, skipped: "bad_earn" };

    const memberRef = db.collection("members").doc(mid);
    const ledgerRef = db.collection("memberLedger").doc();
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(memberRef);
      if (!mSnap.exists) return;
      const m = mSnap.data() || {};
      const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
      const balanceAfter = Math.max(0, balance - points);
      tx.update(memberRef, {
        pointsBalance: balanceAfter,
        updatedAt: now,
        updatedBy: actorId || "pos",
      });
      tx.set(ledgerRef, {
        memberId: mid,
        delta: -points,
        balanceAfter,
        reason: "void_reverse",
        saleId,
        note: "ยกเลิกบิล — คืนแต้มที่สะสม",
        actorType: "system",
        actorId: actorId || "pos",
        createdAt: now,
      });
    });
    return { ok: true, points };
  } catch (err) {
    console.error("tryReverseEarnForVoid", err && err.message);
    return { ok: false, error: String(err && err.message) };
  }
}

/**
 * Validate redeem against an already-read member snap (reads must finish before writes).
 * Returns patch fields; caller applies writes after all tx.get() calls.
 */
function planRedeemFromMemberSnap(mSnap, {
  memberId,
  pointsToRedeem,
  settings,
}) {
  const mid = normalizeMemberId(memberId);
  const pts = Math.trunc(Number(pointsToRedeem) || 0);
  if (pts <= 0) return { redeemBaht: 0, pointsRedeemed: 0 };
  if (!mid) throw new Error("แลกแต้มต้องระบุสมาชิก");
  if (!settings?.enabled) throw new Error("ระบบสมาชิกปิดอยู่");
  const redeemBaht = redeemBahtFromPoints(pts, settings);
  if (redeemBaht <= 0) throw new Error("จำนวนแต้มแลกไม่พอคิดเป็นส่วนลด");
  if (!mSnap || !mSnap.exists) throw new Error("ไม่พบสมาชิก");
  const m = mSnap.data() || {};
  if (m.status === "suspended") throw new Error("บัตรสมาชิกระงับ");
  const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
  if (balance < pts) throw new Error("แต้มไม่พอแลก");
  return {
    redeemBaht,
    pointsRedeemed: pts,
    balanceAfter: balance - pts,
    memberPhone: asString(m.phone, 20),
    memberId: mid,
  };
}

function writeRedeemInSaleTx(tx, db, plan, { saleId, actorId }) {
  if (!plan || !(plan.pointsRedeemed > 0)) return;
  const now = Date.now();
  const memberRef = db.collection("members").doc(plan.memberId);
  const ledgerRef = db.collection("memberLedger").doc();
  tx.update(memberRef, {
    pointsBalance: plan.balanceAfter,
    updatedAt: now,
    updatedBy: actorId || "pos",
  });
  tx.set(ledgerRef, {
    memberId: plan.memberId,
    delta: -plan.pointsRedeemed,
    balanceAfter: plan.balanceAfter,
    reason: "redeem",
    saleId: saleId || "",
    note: `แลกส่วนลด ${plan.redeemBaht} บาท`,
    actorType: "system",
    actorId: actorId || "pos",
    createdAt: now,
  });
}

async function lookupMember(db, phoneInput) {
  const digits = phoneDigitsFromInput(phoneInput);
  if (!digits) return { ok: false, error: "invalid_phone" };
  const snap = await db.collection("members").doc(digits).get();
  if (!snap.exists) return { ok: true, found: false, phoneDigits: digits };
  const m = snap.data() || {};
  return {
    ok: true,
    found: true,
    member: {
      id: snap.id,
      phone: asString(m.phone, 20) || phoneE164(digits),
      phoneDisplay: formatPhoneDisplay(digits),
      displayName: asString(m.displayName, 80) || formatPhoneDisplay(digits),
      cardNo: asString(m.cardNo, 24) || cardNoFromDigits(digits),
      status: m.status === "suspended" ? "suspended" : "active",
      pointsBalance: typeof m.pointsBalance === "number" ? m.pointsBalance : 0,
    },
  };
}

async function quickCreateMember(db, { phone, displayName, actorId, source }) {
  const digits = phoneDigitsFromInput(phone);
  if (!digits) return { ok: false, error: "invalid_phone" };
  const ref = db.collection("members").doc(digits);
  const existing = await ref.get();
  if (existing.exists) {
    return lookupMember(db, digits);
  }
  const settings = await loadMemberSettings(db);
  if (!settings.enabled) return { ok: false, error: "disabled" };
  const now = Date.now();
  const name = asString(displayName, 80) || formatPhoneDisplay(digits);
  const member = {
    phone: phoneE164(digits),
    phoneDigits: digits,
    displayName: name,
    cardNo: cardNoFromDigits(digits),
    status: "active",
    pointsBalance: 0,
    lifetimePointsEarned: 0,
    birthday: "",
    note: "",
    source: source === "qr_self" ? "qr_self" : source === "staff_pos" ? "staff_pos" : "staff_boh",
    createdAt: now,
    updatedAt: now,
    createdBy: actorId || "pos",
    updatedBy: actorId || "pos",
  };
  await ref.set(member);

  if (settings.signupBonusPoints > 0) {
    const ledgerRef = db.collection("memberLedger").doc();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const m = snap.data() || {};
      const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
      const lifetime =
        typeof m.lifetimePointsEarned === "number" ? m.lifetimePointsEarned : 0;
      const bonus = settings.signupBonusPoints;
      const balanceAfter = balance + bonus;
      tx.update(ref, {
        pointsBalance: balanceAfter,
        lifetimePointsEarned: lifetime + bonus,
        updatedAt: Date.now(),
        updatedBy: actorId || "pos",
      });
      tx.set(ledgerRef, {
        memberId: digits,
        delta: bonus,
        balanceAfter,
        reason: "signup_bonus",
        saleId: "",
        note: "โบนัสสมัครสมาชิก",
        actorType: source === "qr_self" ? "customer" : "system",
        actorId: actorId || "pos",
        createdAt: Date.now(),
      });
    });
  }

  return lookupMember(db, digits);
}

async function publicSignup(db, { token, phone, displayName }) {
  const settings = await loadMemberSettings(db);
  if (!settings.enabled) return { ok: false, error: "disabled" };
  if (!settings.publicSignupEnabled) return { ok: false, error: "public_off" };
  const expected = asString(settings.publicSignupToken, 128);
  if (!expected || expected !== asString(token, 128)) {
    return { ok: false, error: "bad_token" };
  }
  return quickCreateMember(db, {
    phone,
    displayName,
    actorId: "qr_self",
    source: "qr_self",
  });
}

module.exports = {
  phoneDigitsFromInput,
  normalizeMemberId,
  loadMemberSettings,
  pointsFromSaleAmount,
  redeemBahtFromPoints,
  tryEarnPointsForSale,
  tryReverseEarnForVoid,
  planRedeemFromMemberSnap,
  writeRedeemInSaleTx,
  lookupMember,
  quickCreateMember,
  publicSignup,
  formatPhoneDisplay,
  cardNoFromDigits,
};
