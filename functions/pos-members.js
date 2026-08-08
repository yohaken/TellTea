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

/** Suspended or soft-deleted — cannot earn / redeem / claim. */
function isMemberInactive(m) {
  const status = m && typeof m.status === "string" ? m.status : "active";
  return status === "suspended" || status === "deleted";
}

function memberStatusLabel(m) {
  if (!m) return "active";
  if (m.status === "deleted") return "deleted";
  if (m.status === "suspended") return "suspended";
  return "active";
}

async function loadMemberSettings(db) {
  const snap = await db.doc("meta/memberSettings").get();
  const d = snap.exists ? snap.data() || {} : {};
  const claimTokenTtlDays =
    typeof d.claimTokenTtlDays === "number" &&
    d.claimTokenTtlDays >= 1 &&
    d.claimTokenTtlDays <= 365
      ? Math.floor(d.claimTokenTtlDays)
      : 30;
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
    receiptClaimEnabled: d.receiptClaimEnabled === true,
    claimTokenTtlDays,
  };
}

function pointsFromSaleAmount(amountBaht, settings) {
  if (!settings?.enabled || !(settings.bahtPerPoint > 0)) return 0;
  if (!(amountBaht > 0)) return 0;
  return Math.floor(amountBaht / settings.bahtPerPoint);
}

function pointsFromReceiptClaim(amountBaht, settings) {
  if (!settings?.enabled || !settings.receiptClaimEnabled) return 0;
  return pointsFromSaleAmount(amountBaht, settings);
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
      if (isMemberInactive(m)) return { skipped: memberStatusLabel(m) };
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
 * Restore points spent on redeem when a sale is voided — best-effort.
 * Idempotent via reason redeem_void_reverse per saleId.
 */
async function tryReverseRedeemForVoid(db, { saleId, actorId }) {
  try {
    if (!saleId) return { ok: false, skipped: "no_sale" };
    if (await ledgerExistsForSale(db, saleId, "redeem_void_reverse")) {
      return { ok: true, skipped: "already_reversed" };
    }
    const redeemSnap = await db
      .collection("memberLedger")
      .where("saleId", "==", saleId)
      .where("reason", "==", "redeem")
      .limit(1)
      .get();
    if (redeemSnap.empty) return { ok: false, skipped: "no_redeem" };
    const redeem = redeemSnap.docs[0].data() || {};
    const mid = asString(redeem.memberId, 32);
    const spent = Math.abs(Math.trunc(Number(redeem.delta) || 0));
    if (!mid || spent <= 0) return { ok: false, skipped: "bad_redeem" };

    const memberRef = db.collection("members").doc(mid);
    const ledgerRef = db.collection("memberLedger").doc();
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(memberRef);
      if (!mSnap.exists) return;
      const m = mSnap.data() || {};
      const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
      const balanceAfter = balance + spent;
      tx.update(memberRef, {
        pointsBalance: balanceAfter,
        updatedAt: now,
        updatedBy: actorId || "pos",
      });
      tx.set(ledgerRef, {
        memberId: mid,
        delta: spent,
        balanceAfter,
        reason: "redeem_void_reverse",
        saleId,
        note: "ยกเลิกบิล — คืนแต้มที่แลก",
        actorType: "system",
        actorId: actorId || "pos",
        createdAt: now,
      });
    });
    return { ok: true, points: spent };
  } catch (err) {
    console.error("tryReverseRedeemForVoid", err && err.message);
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
    let earnSnap = await db
      .collection("memberLedger")
      .where("saleId", "==", saleId)
      .where("reason", "==", "earn_sale")
      .limit(1)
      .get();
    if (earnSnap.empty) {
      earnSnap = await db
        .collection("memberLedger")
        .where("saleId", "==", saleId)
        .where("reason", "==", "earn_receipt_claim")
        .limit(1)
        .get();
    }
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
      const lifetime =
        typeof m.lifetimePointsEarned === "number" ? m.lifetimePointsEarned : 0;
      tx.update(memberRef, {
        pointsBalance: balanceAfter,
        lifetimePointsEarned: Math.max(0, lifetime - points),
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

/** Void path: restore redeem first, then claw back earn — never throws to caller. */
async function tryReverseMemberPointsForVoid(db, { saleId, actorId }) {
  const redeem = await tryReverseRedeemForVoid(db, { saleId, actorId });
  const earn = await tryReverseEarnForVoid(db, { saleId, actorId });
  return { ok: true, redeem, earn };
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
  if (isMemberInactive(m)) {
    throw new Error(m.status === "deleted" ? "สมาชิกถูกลบแล้ว" : "บัตรสมาชิกระงับ");
  }
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
      status: memberStatusLabel(m),
      pointsBalance: typeof m.pointsBalance === "number" ? m.pointsBalance : 0,
    },
  };
}

async function findMemberByGoogleUid(db, googleUid) {
  const uid = asString(googleUid, 128);
  if (!uid) return null;
  const snap = await db.collection("members").where("googleUid", "==", uid).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0];
}

async function quickCreateMember(db, { phone, displayName, actorId, source, googleUid, email }) {
  const digits = phoneDigitsFromInput(phone);
  if (!digits) return { ok: false, error: "invalid_phone" };
  const ref = db.collection("members").doc(digits);
  const existing = await ref.get();
  if (existing.exists) {
    const prev = existing.data() || {};
    if (isMemberInactive(prev)) {
      return { ok: false, error: memberStatusLabel(prev) };
    }
    const patch = {};
    const g = asString(googleUid, 128);
    const em = asString(email, 120).toLowerCase();
    if (g && !asString(existing.get("googleUid"), 128)) patch.googleUid = g;
    if (em && !asString(existing.get("email"), 120)) patch.email = em;
    if (Object.keys(patch).length) {
      patch.updatedAt = Date.now();
      await ref.set(patch, { merge: true });
    }
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
    googleUid: asString(googleUid, 128),
    email: asString(email, 120).toLowerCase(),
    source:
      source === "qr_self"
        ? "qr_self"
        : source === "receipt_qr"
          ? "receipt_qr"
          : source === "staff_pos"
            ? "staff_pos"
            : "staff_boh",
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


function asSaleClaimView(saleId, data, settings) {
  const total = typeof data.total === "number" ? data.total : 0;
  return {
    saleId,
    billNo: asString(data.billNo, 40) || saleId,
    total,
    pointsPreview: pointsFromReceiptClaim(total, settings),
    bahtPerPoint: settings.bahtPerPoint,
    expiresAt: typeof data.claimTokenExpiresAt === "number" ? data.claimTokenExpiresAt : 0,
    claimStatus: asString(data.claimStatus, 24) || "open",
  };
}

async function loadSaleForClaim(db, saleId, token) {
  const id = asString(saleId, 80);
  const tok = asString(token, 128);
  if (!id || !tok) return { ok: false, error: "bad_token" };
  const settings = await loadMemberSettings(db);
  if (!settings.enabled) return { ok: false, error: "disabled" };
  if (!settings.receiptClaimEnabled) return { ok: false, error: "receipt_off" };
  const snap = await db.collection("posSales").doc(id).get();
  if (!snap.exists) return { ok: false, error: "missing_sale" };
  const data = snap.data() || {};
  if (asString(data.claimToken, 128) !== tok) return { ok: false, error: "bad_token" };
  if (data.status === "voided") return { ok: false, error: "voided" };
  const exp = typeof data.claimTokenExpiresAt === "number" ? data.claimTokenExpiresAt : 0;
  if (exp && exp < Date.now()) return { ok: false, error: "expired" };
  if (data.claimStatus === "claimed") {
    return { ok: false, error: "already_claimed", view: asSaleClaimView(id, data, settings) };
  }
  if (await ledgerExistsForSale(db, id, "earn_sale")) {
    return { ok: false, error: "already_earned", view: asSaleClaimView(id, data, settings) };
  }
  if (await ledgerExistsForSale(db, id, "earn_receipt_claim")) {
    return { ok: false, error: "already_claimed", view: asSaleClaimView(id, data, settings) };
  }
  const view = asSaleClaimView(id, data, settings);
  // A1: QR ทุกใบแม้ 0 แต้ม — สแกนแล้วพาไปหน้าสมาชิก ไม่ตัน
  if (!(view.pointsPreview > 0)) {
    return { ok: false, error: "zero_points", view };
  }
  return { ok: true, settings, saleId: id, data, view };
}

async function previewReceiptClaim(db, { saleId, token }) {
  const loaded = await loadSaleForClaim(db, saleId, token);
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      ...(loaded.view || {}),
    };
  }
  return {
    ok: true,
    ...loaded.view,
  };
}

/**
 * Auth session probe for claim page — does this Firebase user already have a member?
 * Never returns another person's data without matching token identity.
 */
async function lookupReceiptClaimAuth(db, auth, { saleId, token, idToken }) {
  const loaded = await loadSaleForClaim(db, saleId, token);
  if (!loaded.ok) return { ok: false, error: loaded.error, ...(loaded.view || {}) };
  const rawToken = asString(idToken, 4096);
  if (!rawToken) return { ok: false, error: "auth_required" };
  let decoded;
  try {
    decoded = await auth.verifyIdToken(rawToken);
  } catch (err) {
    return { ok: false, error: "auth_required" };
  }
  const uid = asString(decoded.uid, 128);
  const phoneDigits = phoneDigitsFromInput(decoded.phone_number);
  let docSnap = null;
  if (phoneDigits) {
    const s = await db.collection("members").doc(phoneDigits).get();
    if (s.exists) docSnap = s;
  }
  if (!docSnap && uid) {
    docSnap = await findMemberByGoogleUid(db, uid);
  }
  if (!docSnap || !docSnap.exists) {
    return {
      ok: true,
      found: false,
      needsPhone: !phoneDigits,
      provider: asString(decoded.firebase && decoded.firebase.sign_in_provider, 40),
      email: asString(decoded.email, 120).toLowerCase(),
      ...loaded.view,
    };
  }
  const m = docSnap.data() || {};
  if (isMemberInactive(m)) return { ok: false, error: memberStatusLabel(m) };
  return {
    ok: true,
    found: true,
    needsPhone: false,
    provider: asString(decoded.firebase && decoded.firebase.sign_in_provider, 40),
    member: {
      id: docSnap.id,
      displayName: asString(m.displayName, 80) || formatPhoneDisplay(docSnap.id),
      cardNo: asString(m.cardNo, 24) || cardNoFromDigits(docSnap.id),
      // balance only for the authenticated owner of this session
      pointsBalance: typeof m.pointsBalance === "number" ? m.pointsBalance : 0,
    },
    ...loaded.view,
  };
}

/** View own member card — requires Firebase idToken (Google or phone OTP). */
async function getMyMember(db, auth, { idToken }) {
  const rawToken = asString(idToken, 4096);
  if (!rawToken) return { ok: false, error: "auth_required" };
  let decoded;
  try {
    decoded = await auth.verifyIdToken(rawToken);
  } catch {
    return { ok: false, error: "auth_required" };
  }
  const uid = asString(decoded.uid, 128);
  const phoneDigits = phoneDigitsFromInput(decoded.phone_number);
  let docSnap = null;
  if (phoneDigits) {
    const s = await db.collection("members").doc(phoneDigits).get();
    if (s.exists) docSnap = s;
  }
  if (!docSnap && uid) docSnap = await findMemberByGoogleUid(db, uid);
  if (!docSnap || !docSnap.exists) return { ok: true, found: false };
  const m = docSnap.data() || {};
  if (isMemberInactive(m)) return { ok: false, error: memberStatusLabel(m) };
  return {
    ok: true,
    found: true,
    member: {
      id: docSnap.id,
      displayName: asString(m.displayName, 80) || formatPhoneDisplay(docSnap.id),
      cardNo: asString(m.cardNo, 24) || cardNoFromDigits(docSnap.id),
      phoneDisplay: formatPhoneDisplay(docSnap.id),
      pointsBalance: typeof m.pointsBalance === "number" ? m.pointsBalance : 0,
      lifetimePointsEarned:
        typeof m.lifetimePointsEarned === "number" ? m.lifetimePointsEarned : 0,
      email: asString(m.email, 120),
    },
  };
}

async function creditReceiptClaimToMember(db, {
  loaded,
  digits,
  displayName,
  isNew,
  note,
}) {
  const settings = loaded.settings;
  const points = pointsFromReceiptClaim(Number(loaded.data.total) || 0, settings);
  if (points <= 0) return { ok: false, error: "zero_points" };

  const memberRef = db.collection("members").doc(digits);
  const saleRef = db.collection("posSales").doc(loaded.saleId);
  const ledgerRef = db.collection("memberLedger").doc();
  const now = Date.now();
  const token = asString(loaded.data.claimToken, 128);

  try {
    const result = await db.runTransaction(async (tx) => {
      const [mSnap, sSnap] = await Promise.all([tx.get(memberRef), tx.get(saleRef)]);
      if (!mSnap.exists) return { error: "not_member" };
      if (!sSnap.exists) return { error: "missing_sale" };
      const sale = sSnap.data() || {};
      if (sale.status === "voided") return { error: "voided" };
      if (asString(sale.claimToken, 128) !== token) return { error: "bad_token" };
      const exp = typeof sale.claimTokenExpiresAt === "number" ? sale.claimTokenExpiresAt : 0;
      if (exp && exp < now) return { error: "expired" };
      if (sale.claimStatus === "claimed") return { error: "already_claimed" };

      const m = mSnap.data() || {};
      if (isMemberInactive(m)) return { error: memberStatusLabel(m) };
      const balance = typeof m.pointsBalance === "number" ? m.pointsBalance : 0;
      const lifetime = typeof m.lifetimePointsEarned === "number" ? m.lifetimePointsEarned : 0;
      const balanceAfter = balance + points;
      const namePatch = asString(displayName, 80);
      const memberPatch = {
        pointsBalance: balanceAfter,
        lifetimePointsEarned: lifetime + points,
        updatedAt: now,
        updatedBy: "receipt_qr",
      };
      if (namePatch && !asString(m.displayName, 80)) {
        memberPatch.displayName = namePatch;
      }
      tx.update(memberRef, memberPatch);
      tx.set(ledgerRef, {
        memberId: digits,
        delta: points,
        balanceAfter,
        reason: "earn_receipt_claim",
        saleId: loaded.saleId,
        note: note || "เคลมจาก QR สลิป",
        channel: "receipt_qr",
        actorType: "customer",
        actorId: digits,
        createdAt: now,
      });
      tx.set(
        saleRef,
        {
          claimStatus: "claimed",
          claimedAt: now,
          claimedByMemberId: digits,
          pointsClaimed: points,
          pointsEarned: points,
          memberId: digits,
          memberPhone: asString(m.phone, 20) || phoneE164(digits),
        },
        { merge: true },
      );
      return {
        points,
        balanceAfter,
        displayName:
          asString(memberPatch.displayName, 80) ||
          asString(m.displayName, 80) ||
          formatPhoneDisplay(digits),
        cardNo: asString(m.cardNo, 24) || cardNoFromDigits(digits),
      };
    });

    if (result.error) return { ok: false, error: result.error };
    return {
      ok: true,
      points: result.points,
      balanceAfter: result.balanceAfter,
      member: {
        id: digits,
        displayName: result.displayName,
        cardNo: result.cardNo,
        pointsBalance: result.balanceAfter,
        isNew: isNew === true,
      },
    };
  } catch (err) {
    console.error("creditReceiptClaimToMember", err && err.message);
    return { ok: false, error: "claim_failed" };
  }
}

/**
 * Claim points — requires Firebase Auth (Google or phone OTP).
 * New Google users must supply phone + PDPA once to create members/{phone}.
 * One claim per sale QR.
 */
async function claimReceiptPoints(db, auth, {
  saleId,
  token,
  phone,
  displayName,
  pdpaAccepted,
  idToken,
}) {
  const loaded = await loadSaleForClaim(db, saleId, token);
  if (!loaded.ok) return { ok: false, error: loaded.error, ...(loaded.view || {}) };

  const rawToken = asString(idToken, 4096);
  if (!rawToken) return { ok: false, error: "auth_required" };
  let decoded;
  try {
    decoded = await auth.verifyIdToken(rawToken);
  } catch (err) {
    console.error("claimReceiptPoints verifyIdToken", err && err.message);
    return { ok: false, error: "auth_required" };
  }

  const uid = asString(decoded.uid, 128);
  const email = asString(decoded.email, 120).toLowerCase();
  const phoneFromAuth = asString(decoded.phone_number, 32);
  let digits = phoneDigitsFromInput(phoneFromAuth);
  let existingDoc = null;

  if (digits) {
    const s = await db.collection("members").doc(digits).get();
    if (s.exists) existingDoc = s;
  }
  if (!existingDoc && uid) {
    existingDoc = await findMemberByGoogleUid(db, uid);
    if (existingDoc) digits = existingDoc.id;
  }

  let isNew = false;
  if (!existingDoc || !existingDoc.exists) {
    // First-time signup: phone must be OTP-verified on the Auth token
    // (Google path links phone; phone-only path signs in with OTP).
    digits = phoneDigitsFromInput(phoneFromAuth);
    if (!digits) return { ok: false, error: "phone_otp_required" };
    const bodyDigits = phoneDigitsFromInput(phone);
    if (bodyDigits && bodyDigits !== digits) {
      return { ok: false, error: "phone_mismatch" };
    }
    if (pdpaAccepted !== true) return { ok: false, error: "pdpa_required" };
    const beforeCreate = await db.collection("members").doc(digits).get();
    const created = await quickCreateMember(db, {
      phone: phoneFromAuth || phone || digits,
      displayName: displayName || (email ? email.split("@")[0] : ""),
      actorId: "receipt_qr",
      source: "receipt_qr",
      googleUid: uid,
      email,
    });
    if (!created.ok) return created;
    isNew = !beforeCreate.exists;
  } else {
    const m = existingDoc.data() || {};
    if (isMemberInactive(m)) return { ok: false, error: memberStatusLabel(m) };
    digits = existingDoc.id;
    const patch = {};
    if (uid && !asString(m.googleUid, 128)) patch.googleUid = uid;
    if (email && !asString(m.email, 120)) patch.email = email;
    if (Object.keys(patch).length) {
      patch.updatedAt = Date.now();
      await existingDoc.ref.set(patch, { merge: true });
    }
  }

  return creditReceiptClaimToMember(db, {
    loaded,
    digits,
    displayName,
    isNew,
    note: isNew ? "สมัคร+เคลมจาก QR สลิป" : "เคลมจาก QR สลิป",
  });
}

function randomClaimToken() {
  try {
    const { randomUUID } = require("crypto");
    return randomUUID().replace(/-/g, "");
  } catch {
    return `tt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

function buildPublicClaimUrl(saleId, token) {
  const s = encodeURIComponent(String(saleId || ""));
  const t = encodeURIComponent(String(token || ""));
  return `https://telltea-shop.web.app/claim/?s=${s}&t=${t}`;
}

/**
 * Issue / reuse claim token on a completed sale for slip QR (A1 — even 0 points).
 * No-op when members or receiptClaim flag is off. Never throws to sale path.
 */
async function tryIssueReceiptClaimForSale(db, { saleId, total, actorId }) {
  try {
    const id = asString(saleId, 80);
    if (!id) return null;
    const settings = await loadMemberSettings(db);
    if (!settings.enabled || !settings.receiptClaimEnabled) return null;

    const ref = db.collection("posSales").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data.status === "voided") return null;

    const now = Date.now();
    const ttlMs = Math.max(1, settings.claimTokenTtlDays) * 24 * 60 * 60 * 1000;
    const existingToken = asString(data.claimToken, 128);
    const existingExp =
      typeof data.claimTokenExpiresAt === "number" ? data.claimTokenExpiresAt : 0;
    const claimed = data.claimStatus === "claimed";
    const canReuse =
      existingToken.length >= 16 && (claimed || existingExp > now + 60_000);

    const token = canReuse ? existingToken : randomClaimToken();
    const expiresAt = canReuse && existingExp > now ? existingExp : now + ttlMs;

    if (!canReuse || !claimed) {
      const patch = {
        claimToken: token,
        claimTokenExpiresAt: expiresAt,
        claimIssuedAt: now,
        claimIssuedBy: actorId || "pos",
      };
      if (!claimed) patch.claimStatus = "open";
      await ref.set(patch, { merge: true });
    }

    return {
      claimToken: token,
      claimUrl: buildPublicClaimUrl(id, token),
      claimExpiresAt: expiresAt,
      claimPointsPreview: pointsFromReceiptClaim(Number(total) || 0, settings),
    };
  } catch (err) {
    console.error("tryIssueReceiptClaimForSale", err && err.message);
    return null;
  }
}

module.exports = {
  phoneDigitsFromInput,
  normalizeMemberId,
  loadMemberSettings,
  pointsFromSaleAmount,
  pointsFromReceiptClaim,
  redeemBahtFromPoints,
  tryEarnPointsForSale,
  tryReverseEarnForVoid,
  tryReverseRedeemForVoid,
  tryReverseMemberPointsForVoid,
  planRedeemFromMemberSnap,
  writeRedeemInSaleTx,
  tryIssueReceiptClaimForSale,
  buildPublicClaimUrl,
  lookupMember,
  quickCreateMember,
  publicSignup,
  previewReceiptClaim,
  lookupReceiptClaimAuth,
  getMyMember,
  claimReceiptPoints,
  formatPhoneDisplay,
  cardNoFromDigits,
};
