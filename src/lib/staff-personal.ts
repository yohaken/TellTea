import { deleteField, doc, getDoc, setDoc, updateDoc, collection, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import type { StaffPersonalData } from "./types";

function staffPersonalRef(staffId: string) {
  return doc(getDb(), "staffPersonal", staffId);
}

export async function getStaffPersonal(staffId: string): Promise<StaffPersonalData | null> {
  const snap = await getDoc(staffPersonalRef(staffId));
  if (!snap.exists()) return null;
  return snap.data() as StaffPersonalData;
}

/** เจ้าของ — โหลดข้อมูลส่วนตัวทุกคนสำหรับตารางสรุป */
export async function listStaffPersonalMap(): Promise<Map<string, StaffPersonalData>> {
  const snap = await getDocs(collection(getDb(), "staffPersonal"));
  const map = new Map<string, StaffPersonalData>();
  for (const d of snap.docs) {
    map.set(d.id, d.data() as StaffPersonalData);
  }
  return map;
}

export type StaffPersonalPatch = {
  legalFirstName?: string | null;
  legalLastName?: string | null;
  idCardPhotoUrl?: string | null;
  personalDataConsentAt?: number | null;
};

export async function saveStaffPersonal(
  staffId: string,
  patch: StaffPersonalPatch,
): Promise<StaffPersonalData> {
  const next: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.legalFirstName !== undefined) {
    next.legalFirstName =
      patch.legalFirstName && patch.legalFirstName.trim()
        ? patch.legalFirstName.trim()
        : deleteField();
  }
  if (patch.legalLastName !== undefined) {
    next.legalLastName =
      patch.legalLastName && patch.legalLastName.trim()
        ? patch.legalLastName.trim()
        : deleteField();
  }
  if (patch.idCardPhotoUrl !== undefined) {
    next.idCardPhotoUrl =
      patch.idCardPhotoUrl && patch.idCardPhotoUrl.trim()
        ? patch.idCardPhotoUrl.trim()
        : deleteField();
  }
  if (patch.personalDataConsentAt !== undefined) {
    next.personalDataConsentAt =
      patch.personalDataConsentAt == null ? deleteField() : patch.personalDataConsentAt;
  }

  const existing = await getDoc(staffPersonalRef(staffId));
  if (existing.exists()) {
    await updateDoc(staffPersonalRef(staffId), next);
  } else {
    await setDoc(staffPersonalRef(staffId), next);
  }

  const saved = await getStaffPersonal(staffId);
  if (!saved) throw new Error("บันทึกข้อมูลส่วนตัวไม่สำเร็จ");
  return saved;
}
