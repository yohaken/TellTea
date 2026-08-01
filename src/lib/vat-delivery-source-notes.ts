/**
 * โน้ตส่วนตัวบนหน้าที่มายอดเดลิเวอรี่ — เจ้าของจดเอง
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export const VAT_DELIVERY_SOURCE_NOTES_DOC = "vatDeliverySourceNotes";

export type VatDeliverySourceNotes = {
  text: string;
  updatedAt: number;
  updatedBy: string;
};

export async function loadVatDeliverySourceNotes(): Promise<VatDeliverySourceNotes> {
  const snap = await getDoc(
    doc(getDb(), "meta", VAT_DELIVERY_SOURCE_NOTES_DOC),
  );
  if (!snap.exists()) {
    return { text: "", updatedAt: 0, updatedBy: "" };
  }
  const raw = snap.data() || {};
  return {
    text: String(raw.text || ""),
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

export async function saveVatDeliverySourceNotes(
  text: string,
  actor: string,
): Promise<VatDeliverySourceNotes> {
  const next: VatDeliverySourceNotes = {
    text: String(text || ""),
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
  };
  await setDoc(doc(getDb(), "meta", VAT_DELIVERY_SOURCE_NOTES_DOC), next, {
    merge: true,
  });
  return next;
}
