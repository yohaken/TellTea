/**
 * โน้ตสำหรับ local AI เท่านั้น — เก็บใน Firestore meta
 * แก้ข้อความได้โดยไม่ต้องแก้โครงสร้างเว็บ
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";
import { TUNE_DESK_PROTOCOL } from "./vat-agent-chat";
import { VAT_IMPORT_AI_RULES } from "./vat-import-guide";
import { VAT_IMPORT_VERIFY_NOTES } from "./vat-import-verify";



export const VAT_IMPORT_AI_NOTES_DOC = "vatImportAiNotes";

export type VatImportAiNotes = {
  text: string;
  updatedAt: number;
  updatedBy: string;
};

export function defaultVatImportAiNotesText(): string {
  return [
    "VAT IMPORT — AI NOTES",
    "อ่านจาก #vat-import-ai-notes · คนไม่ต้องอ่าน",
    "",
    ...VAT_IMPORT_AI_RULES.map((r, i) => `${i + 1}. ${r}`),
    "",
    "— โต๊ะจูน —",
    ...TUNE_DESK_PROTOCOL.map((r, i) => `T${i + 1}. ${r}`),
    "",
    "— verify —",
    ...VAT_IMPORT_VERIFY_NOTES.map((r, i) => `V${i + 1}. ${r}`),
  ].join("\n");
}





export async function loadVatImportAiNotes(): Promise<VatImportAiNotes> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_IMPORT_AI_NOTES_DOC));
  if (!snap.exists()) {
    return {
      text: defaultVatImportAiNotesText(),
      updatedAt: 0,
      updatedBy: "",
    };
  }
  const raw = snap.data() || {};
  const text = String(raw.text || "").trim();
  return {
    text: text || defaultVatImportAiNotesText(),
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

export async function saveVatImportAiNotes(
  text: string,
  actor: string,
): Promise<VatImportAiNotes> {
  const next: VatImportAiNotes = {
    text: String(text || "").trim() || defaultVatImportAiNotesText(),
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
  };
  await setDoc(doc(getDb(), "meta", VAT_IMPORT_AI_NOTES_DOC), next, {
    merge: true,
  });
  return next;
}
