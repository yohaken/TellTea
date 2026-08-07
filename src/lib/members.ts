import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  formatPhoneDisplay,
  normalizePhone,
  phoneDigitsFromE164,
} from "./utils";

/** แหล่งสมัคร — จอง `qr_self` ไว้ตั้งแต่โครง (M4) */
export type MemberSource = "staff_boh" | "staff_pos" | "qr_self";

export type MemberStatus = "active" | "suspended";

export type MemberLedgerReason =
  | "earn_sale"
  | "redeem"
  | "adjust"
  | "signup_bonus";

export type ShopMember = {
  /** phoneDigits จาก E.164 (เช่น 66812345678) */
  id: string;
  phone: string;
  phoneDigits: string;
  displayName: string;
  /** เลขบัตรแสดงผล */
  cardNo: string;
  status: MemberStatus;
  pointsBalance: number;
  lifetimePointsEarned: number;
  /** YYYY-MM-DD หรือว่าง */
  birthday: string;
  note: string;
  source: MemberSource;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
};

export type MemberLedgerEntry = {
  id: string;
  memberId: string;
  delta: number;
  balanceAfter: number;
  reason: MemberLedgerReason;
  saleId: string;
  note: string;
  actorType: "staff" | "system" | "customer";
  actorId: string;
  createdAt: number;
};

export type MemberSettings = {
  enabled: boolean;
  /** ทุก bahtPerPoint บาท = 1 แต้ม (ปัดลง) */
  bahtPerPoint: number;
  /** แต้มต่อ 1 บาทส่วนลดตอนแลก — ใช้ M3 */
  pointsPerBahtRedeem: number;
  signupBonusPoints: number;
  /** ธงโครง QR — ยังไม่เปิด UI สาธารณะ */
  publicSignupEnabled: boolean;
  publicSignupToken: string;
  updatedAt: number;
  updatedBy: string;
};

export const MEMBERS_COLLECTION = "members";
export const MEMBER_LEDGER_COLLECTION = "memberLedger";
export const MEMBER_SETTINGS_DOC = "memberSettings";

export const DEFAULT_MEMBER_SETTINGS: MemberSettings = {
  enabled: true,
  bahtPerPoint: 25,
  pointsPerBahtRedeem: 1,
  signupBonusPoints: 0,
  publicSignupEnabled: false,
  publicSignupToken: "",
  updatedAt: 0,
  updatedBy: "",
};

export const MEMBER_SOURCE_LABELS: Record<MemberSource, string> = {
  staff_boh: "หลังร้าน",
  staff_pos: "หน้าร้าน",
  qr_self: "สแกน QR",
};

export const MEMBER_LEDGER_REASON_LABELS: Record<MemberLedgerReason, string> = {
  earn_sale: "สะสมจากบิล",
  redeem: "แลกแต้ม",
  adjust: "ปรับมือ",
  signup_bonus: "โบนัสสมัคร",
};

function membersCol() {
  return collection(getDb(), MEMBERS_COLLECTION);
}

function memberRef(id: string) {
  return doc(getDb(), MEMBERS_COLLECTION, id);
}

function ledgerCol() {
  return collection(getDb(), MEMBER_LEDGER_COLLECTION);
}

function settingsRef() {
  return doc(getDb(), "meta", MEMBER_SETTINGS_DOC);
}

export function memberIdFromPhone(phoneInput: string): string {
  return phoneDigitsFromE164(phoneInput);
}

export function cardNoFromPhoneDigits(phoneDigits: string): string {
  const tail = phoneDigits.replace(/\D/g, "").slice(-8);
  return `TT${tail.padStart(8, "0")}`;
}

function mapMember(snap: QueryDocumentSnapshot | { id: string; data: () => Record<string, unknown> }): ShopMember {
  const d = snap.data() as Partial<ShopMember>;
  const phone = typeof d.phone === "string" ? d.phone : "";
  const phoneDigits =
    typeof d.phoneDigits === "string" && d.phoneDigits
      ? d.phoneDigits
      : snap.id;
  return {
    id: snap.id,
    phone,
    phoneDigits,
    displayName: typeof d.displayName === "string" ? d.displayName : "",
    cardNo:
      typeof d.cardNo === "string" && d.cardNo
        ? d.cardNo
        : cardNoFromPhoneDigits(phoneDigits),
    status: d.status === "suspended" ? "suspended" : "active",
    pointsBalance: typeof d.pointsBalance === "number" ? d.pointsBalance : 0,
    lifetimePointsEarned:
      typeof d.lifetimePointsEarned === "number" ? d.lifetimePointsEarned : 0,
    birthday: typeof d.birthday === "string" ? d.birthday : "",
    note: typeof d.note === "string" ? d.note : "",
    source:
      d.source === "staff_pos" || d.source === "qr_self" ? d.source : "staff_boh",
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    createdBy: typeof d.createdBy === "string" ? d.createdBy : "",
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : "",
  };
}

function mapLedger(snap: QueryDocumentSnapshot): MemberLedgerEntry {
  const d = snap.data() as Partial<MemberLedgerEntry>;
  const reason = d.reason;
  return {
    id: snap.id,
    memberId: typeof d.memberId === "string" ? d.memberId : "",
    delta: typeof d.delta === "number" ? d.delta : 0,
    balanceAfter: typeof d.balanceAfter === "number" ? d.balanceAfter : 0,
    reason:
      reason === "earn_sale" ||
      reason === "redeem" ||
      reason === "signup_bonus"
        ? reason
        : "adjust",
    saleId: typeof d.saleId === "string" ? d.saleId : "",
    note: typeof d.note === "string" ? d.note : "",
    actorType:
      d.actorType === "system" || d.actorType === "customer"
        ? d.actorType
        : "staff",
    actorId: typeof d.actorId === "string" ? d.actorId : "",
    createdAt: typeof d.createdAt === "number" ? d.createdAt : 0,
  };
}

function mapSettings(data: Partial<MemberSettings> | undefined): MemberSettings {
  if (!data) return { ...DEFAULT_MEMBER_SETTINGS };
  return {
    enabled: data.enabled !== false,
    bahtPerPoint:
      typeof data.bahtPerPoint === "number" && data.bahtPerPoint > 0
        ? data.bahtPerPoint
        : DEFAULT_MEMBER_SETTINGS.bahtPerPoint,
    pointsPerBahtRedeem:
      typeof data.pointsPerBahtRedeem === "number" && data.pointsPerBahtRedeem > 0
        ? data.pointsPerBahtRedeem
        : DEFAULT_MEMBER_SETTINGS.pointsPerBahtRedeem,
    signupBonusPoints:
      typeof data.signupBonusPoints === "number" && data.signupBonusPoints >= 0
        ? Math.floor(data.signupBonusPoints)
        : 0,
    publicSignupEnabled: data.publicSignupEnabled === true,
    publicSignupToken:
      typeof data.publicSignupToken === "string" ? data.publicSignupToken : "",
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
  };
}

export async function getMemberSettings(): Promise<MemberSettings> {
  const snap = await getDoc(settingsRef());
  if (!snap.exists()) return { ...DEFAULT_MEMBER_SETTINGS };
  return mapSettings(snap.data() as Partial<MemberSettings>);
}

export async function saveMemberSettings(
  patch: Partial<
    Pick<
      MemberSettings,
      | "enabled"
      | "bahtPerPoint"
      | "pointsPerBahtRedeem"
      | "signupBonusPoints"
      | "publicSignupEnabled"
      | "publicSignupToken"
    >
  >,
  updatedBy: string,
): Promise<MemberSettings> {
  const current = await getMemberSettings();
  const next: MemberSettings = {
    ...current,
    ...patch,
    bahtPerPoint:
      typeof patch.bahtPerPoint === "number" && patch.bahtPerPoint > 0
        ? patch.bahtPerPoint
        : current.bahtPerPoint,
    pointsPerBahtRedeem:
      typeof patch.pointsPerBahtRedeem === "number" && patch.pointsPerBahtRedeem > 0
        ? patch.pointsPerBahtRedeem
        : current.pointsPerBahtRedeem,
    signupBonusPoints:
      typeof patch.signupBonusPoints === "number" && patch.signupBonusPoints >= 0
        ? Math.floor(patch.signupBonusPoints)
        : current.signupBonusPoints,
    updatedAt: Date.now(),
    updatedBy,
  };
  await setDoc(
    settingsRef(),
    {
      enabled: next.enabled,
      bahtPerPoint: next.bahtPerPoint,
      pointsPerBahtRedeem: next.pointsPerBahtRedeem,
      signupBonusPoints: next.signupBonusPoints,
      publicSignupEnabled: next.publicSignupEnabled,
      publicSignupToken: next.publicSignupToken,
      updatedAt: next.updatedAt,
      updatedBy: next.updatedBy,
    },
    { merge: true },
  );
  return next;
}

export async function getMember(id: string): Promise<ShopMember | null> {
  const snap = await getDoc(memberRef(id));
  if (!snap.exists()) return null;
  return mapMember({ id: snap.id, data: () => snap.data() as Record<string, unknown> });
}

export async function getMemberByPhone(phoneInput: string): Promise<ShopMember | null> {
  return getMember(memberIdFromPhone(phoneInput));
}

/** รายการล่าสุด (อัปเดตล่าสุดก่อน) */
export async function listMembers(max = 200): Promise<ShopMember[]> {
  const q = query(membersCol(), orderBy("updatedAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(mapMember);
}

export function filterMembers(
  members: ShopMember[],
  rawQuery: string,
): ShopMember[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return members;
  const digits = q.replace(/\D/g, "");
  return members.filter((m) => {
    if (m.displayName.toLowerCase().includes(q)) return true;
    if (m.cardNo.toLowerCase().includes(q)) return true;
    if (m.note.toLowerCase().includes(q)) return true;
    if (digits && (m.phoneDigits.includes(digits) || m.phone.includes(digits))) {
      return true;
    }
    try {
      if (digits && formatPhoneDisplay(m.phone).includes(digits)) return true;
    } catch {
      /* ignore */
    }
    return false;
  });
}

export type CreateMemberInput = {
  phone: string;
  displayName: string;
  birthday?: string;
  note?: string;
  source?: MemberSource;
  /** ถ้า true จะให้โบนัสสมัครตาม settings (ledger signup_bonus) */
  applySignupBonus?: boolean;
};

export async function createMember(
  input: CreateMemberInput,
  actorId: string,
): Promise<ShopMember> {
  const phone = normalizePhone(input.phone);
  const phoneDigits = phoneDigitsFromE164(phone);
  const id = phoneDigits;
  const existing = await getDoc(memberRef(id));
  if (existing.exists()) {
    throw new Error("เบอร์นี้เป็นสมาชิกแล้ว");
  }

  const now = Date.now();
  const displayName = input.displayName.trim() || formatPhoneDisplay(phone);
  const member: ShopMember = {
    id,
    phone,
    phoneDigits,
    displayName,
    cardNo: cardNoFromPhoneDigits(phoneDigits),
    status: "active",
    pointsBalance: 0,
    lifetimePointsEarned: 0,
    birthday: (input.birthday || "").trim(),
    note: (input.note || "").trim(),
    source: input.source || "staff_boh",
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
  };

  await setDoc(memberRef(id), {
    phone: member.phone,
    phoneDigits: member.phoneDigits,
    displayName: member.displayName,
    cardNo: member.cardNo,
    status: member.status,
    pointsBalance: 0,
    lifetimePointsEarned: 0,
    birthday: member.birthday,
    note: member.note,
    source: member.source,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    createdBy: member.createdBy,
    updatedBy: member.updatedBy,
  });

  if (input.applySignupBonus !== false) {
    const settings = await getMemberSettings();
    if (settings.enabled && settings.signupBonusPoints > 0) {
      return adjustMemberPoints(
        {
          memberId: id,
          delta: settings.signupBonusPoints,
          reason: "signup_bonus",
          note: "โบนัสสมัครสมาชิก",
        },
        actorId,
      );
    }
  }

  return member;
}

export type UpdateMemberInput = {
  displayName?: string;
  birthday?: string;
  note?: string;
  status?: MemberStatus;
};

export async function updateMember(
  id: string,
  patch: UpdateMemberInput,
  actorId: string,
): Promise<ShopMember> {
  const ref = memberRef(id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("ไม่พบสมาชิก");

  const data: Record<string, unknown> = {
    updatedAt: Date.now(),
    updatedBy: actorId,
  };
  if (typeof patch.displayName === "string") {
    data.displayName = patch.displayName.trim();
  }
  if (typeof patch.birthday === "string") {
    data.birthday = patch.birthday.trim();
  }
  if (typeof patch.note === "string") {
    data.note = patch.note.trim();
  }
  if (patch.status === "active" || patch.status === "suspended") {
    data.status = patch.status;
  }

  await updateDoc(ref, data);
  const next = await getMember(id);
  if (!next) throw new Error("ไม่พบสมาชิก");
  return next;
}

export type AdjustPointsInput = {
  memberId: string;
  delta: number;
  reason?: MemberLedgerReason;
  note?: string;
  saleId?: string;
  actorType?: MemberLedgerEntry["actorType"];
};

/**
 * เปลี่ยนแต้มผ่าน transaction + ledger เท่านั้น
 * delta เป็นจำนวนเต็ม (บวก/ลบ) — ยอดหลังแก้ต้อง >= 0
 */
export async function adjustMemberPoints(
  input: AdjustPointsInput,
  actorId: string,
): Promise<ShopMember> {
  const delta = Math.trunc(input.delta);
  if (!delta) throw new Error("จำนวนแต้มต้องไม่เป็นศูนย์");
  const note = (input.note || "").trim();
  if (input.reason === "adjust" || !input.reason) {
    if (!note) throw new Error("ระบุเหตุผลตอนปรับแต้ม");
  }

  const mRef = memberRef(input.memberId);
  const ledgerRef = doc(ledgerCol());

  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(mRef);
    if (!snap.exists()) throw new Error("ไม่พบสมาชิก");
    const before = snap.data() as Partial<ShopMember>;
    const balance =
      typeof before.pointsBalance === "number" ? before.pointsBalance : 0;
    const lifetime =
      typeof before.lifetimePointsEarned === "number"
        ? before.lifetimePointsEarned
        : 0;
    const balanceAfter = balance + delta;
    if (balanceAfter < 0) throw new Error("แต้มไม่พอ (ยอดจะติดลบ)");

    const now = Date.now();
    const reason: MemberLedgerReason = input.reason || "adjust";
    tx.update(mRef, {
      pointsBalance: balanceAfter,
      lifetimePointsEarned: delta > 0 ? lifetime + delta : lifetime,
      updatedAt: now,
      updatedBy: actorId,
    });
    tx.set(ledgerRef, {
      memberId: input.memberId,
      delta,
      balanceAfter,
      reason,
      saleId: input.saleId || "",
      note,
      actorType: input.actorType || "staff",
      actorId,
      createdAt: now,
    });
  });

  const next = await getMember(input.memberId);
  if (!next) throw new Error("ไม่พบสมาชิก");
  return next;
}

export async function listMemberLedger(
  memberId: string,
  max = 50,
): Promise<MemberLedgerEntry[]> {
  const q = query(
    ledgerCol(),
    where("memberId", "==", memberId),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapLedger);
}

/** คะแนนที่จะได้จากยอดขาย (ปัดลง) — ใช้ M2 */
export function pointsFromSaleAmount(
  amountBaht: number,
  settings: MemberSettings = DEFAULT_MEMBER_SETTINGS,
): number {
  if (!settings.enabled || settings.bahtPerPoint <= 0) return 0;
  if (!(amountBaht > 0)) return 0;
  return Math.floor(amountBaht / settings.bahtPerPoint);
}
