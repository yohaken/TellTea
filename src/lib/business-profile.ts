import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { getDb } from "./firebase";

/**
 * โปรไฟล์กิจการ — ให้ AI จัดประเภทบัญชีอ่านบริบท
 * เก็บที่ meta/businessProfile (ไม่มี secret — staff อ่านได้)
 */
export type BusinessProfile = {
  /** เช่น ร้านชานมไข่มุก + เบเกอรี่ */
  businessType: string;
  /** สินค้า/บริการหลัก */
  productsServices: string;
  /** สิ่งที่ควรเป็นต้นทุน (cogs) */
  cogsExamples: string;
  /** สิ่งที่ควรเป็นค่าใช้จ่าย (sga) */
  sgaExamples: string;
  /** สิ่งที่ควรเป็นสินทรัพย์ (asset) */
  assetExamples: string;
  /** ชั่วโมงเปิดทำการ */
  openHours: string;
  /** สัดส่วนต้นทุนโดยประมาณ */
  costStructure: string;
  /** หมายเหตุเพิ่มให้ AI */
  aiNotes: string;
  /**
   * โลโก้ร้าน — มักเป็น PNG โปร่งใส
   * ค่าเป็น `evp:{id}` หรือ https/data URL
   */
  logoUrl: string;
  updatedAt: number;
  updatedBy: string;
};

/** ค่าเริ่มต้น TellTea — ตามที่เจ้าของอธิบาย */
export const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  businessType: "ร้านชานมไข่มุก (bubble tea) ที่ทำเบเกอรี่ควบคู่",
  productsServices:
    "เครื่องดื่มชานมไข่มุก / เครื่องดื่มที่เกี่ยวข้อง · เบเกอรี่ที่ร้านผลิตเอง · เปิดบริการลูกค้าหน้าร้าน",
  cogsExamples:
    "วัตถุดิบเครื่องดื่มและบรรจุภัณฑ์: แก้ว หลอด ถุง ฝา · วัตถุดิบเบเกอรี่: แป้ง มันสำปะหลัง กล้วย และของเกี่ยวข้อง · น้ำดิบ/ค่าน้ำที่ผ่านระบบกรองเป็นน้ำดื่มสำหรับผลิต · ค่าขนส่ง/ค่าส่งวัตถุดิบและบรรจุภัณฑ์ (เช่น ค่าขนส่งแก้ว)",
  sgaExamples:
    "ค่าแรง/โบนัสพนักงาน (หัวใจหลักของร้าน) · ค่าไฟ (รวมแอร์และเครื่องใช้ไฟฟ้า — แยกเป็นค่าใช้จ่ายเสมอ แม้มีเครื่องทำน้ำแข็ง) · ค่าเช่า ค่าเน็ต ค่าน้ำประปาส่วนที่ไม่ใช่ต้นทุนผลิตโดยตรง · ค่าซ่อมบำรุง ทำความสะอาด ค่าขนส่งทั่วไปที่ไม่เกี่ยวกับวัตถุดิบ",
  assetExamples:
    "เครื่องจักรและอุปกรณ์ถาวรที่เกี่ยวเนื่องกับการชง/ผลิต/เบเกอรี่ · ระบบกรองน้ำ (ทุนหลักด้านน้ำดื่ม) · ตู้ แอร์ อุปกรณ์ใช้งานหลายปี — ไม่รวมค่าซ่อม",
  openHours: "เปิดตลอด 24 ชั่วโมง",
  costStructure:
    "โดยภาพรวมต้นทุนวัตถุดิบ (cogs) ประมาณ 40% ของโครงสร้างต้นทุน · ส่วนที่เหลือเป็นค่าแรงพนักงานและค่าใช้จ่ายอื่น (sga)",
  aiNotes:
    "แยกให้ชัด: ค่าไฟ = sga เสมอ · ค่าน้ำ/ระบบกรองที่เกี่ยวกับน้ำดื่มผลิต = พิจารณาเป็น cogs เมื่อเป็นต้นทุนผลิต · พนักงาน = sga · อย่าสับสนคำว่าเครื่องในเครื่องดื่มกับเครื่องจักร",
  logoUrl: "",
  updatedAt: 0,
  updatedBy: "",
};

/** localStorage + event — ให้ AppBrand แทนโลโก้เดิมทันทีหลังอัปโหลด */
export const BRAND_LOGO_STORAGE_KEY = "telltea-brand-logo-v1";
export const BRAND_LOGO_CHANGED_EVENT = "telltea-brand-logo";

function profileRef() {
  return doc(getDb(), "meta", "businessProfile");
}

export function peekCachedBrandLogo(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(BRAND_LOGO_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function cacheBrandLogo(logoUrl: string) {
  if (typeof window === "undefined") return;
  const next = String(logoUrl || "").trim();
  try {
    if (next) window.localStorage.setItem(BRAND_LOGO_STORAGE_KEY, next);
    else window.localStorage.removeItem(BRAND_LOGO_STORAGE_KEY);
  } catch {
    /* quota / private mode */
  }
  window.dispatchEvent(new CustomEvent(BRAND_LOGO_CHANGED_EVENT, { detail: next }));
}

/** บันทึกโลโก้ทันที (data URL / evp) — แทนโลโก้เดิมทั่วแอปโดยไม่ต้องรอเซฟฟอร์มทั้งใบ */
export async function saveBusinessLogo(logoUrl: string, updatedBy: string): Promise<void> {
  const next = String(logoUrl || "").trim();
  await setDoc(
    profileRef(),
    {
      logoUrl: next,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
  cacheBrandLogo(next);
}

function mapProfile(data: Partial<BusinessProfile> | undefined): BusinessProfile {
  return {
    businessType: String(data?.businessType ?? DEFAULT_BUSINESS_PROFILE.businessType).trim(),
    productsServices: String(
      data?.productsServices ?? DEFAULT_BUSINESS_PROFILE.productsServices,
    ).trim(),
    cogsExamples: String(data?.cogsExamples ?? DEFAULT_BUSINESS_PROFILE.cogsExamples).trim(),
    sgaExamples: String(data?.sgaExamples ?? DEFAULT_BUSINESS_PROFILE.sgaExamples).trim(),
    assetExamples: String(data?.assetExamples ?? DEFAULT_BUSINESS_PROFILE.assetExamples).trim(),
    openHours: String(data?.openHours ?? DEFAULT_BUSINESS_PROFILE.openHours).trim(),
    costStructure: String(data?.costStructure ?? DEFAULT_BUSINESS_PROFILE.costStructure).trim(),
    aiNotes: String(data?.aiNotes ?? DEFAULT_BUSINESS_PROFILE.aiNotes).trim(),
    logoUrl: String(data?.logoUrl || "").trim(),
    updatedAt: Number(data?.updatedAt) || 0,
    updatedBy: String(data?.updatedBy || ""),
  };
}

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const snap = await getDoc(profileRef());
  if (!snap.exists()) return { ...DEFAULT_BUSINESS_PROFILE };
  return mapProfile(snap.data() as Partial<BusinessProfile>);
}

/** ถ้ายังไม่มีเอกสาร — เขียนค่าเริ่มต้น TellTea ลง Firestore */
export async function ensureBusinessProfileSeeded(updatedBy: string): Promise<BusinessProfile> {
  const snap = await getDoc(profileRef());
  if (snap.exists()) return mapProfile(snap.data() as Partial<BusinessProfile>);
  const seeded: BusinessProfile = {
    ...DEFAULT_BUSINESS_PROFILE,
    updatedAt: Date.now(),
    updatedBy,
  };
  await setDoc(profileRef(), seeded, { merge: true });
  return seeded;
}

export async function saveBusinessProfile(
  patch: Omit<BusinessProfile, "updatedAt" | "updatedBy">,
  updatedBy: string,
): Promise<void> {
  const logoUrl = String(patch.logoUrl || "").trim();
  await setDoc(
    profileRef(),
    {
      businessType: String(patch.businessType || "").trim(),
      productsServices: String(patch.productsServices || "").trim(),
      cogsExamples: String(patch.cogsExamples || "").trim(),
      sgaExamples: String(patch.sgaExamples || "").trim(),
      assetExamples: String(patch.assetExamples || "").trim(),
      openHours: String(patch.openHours || "").trim(),
      costStructure: String(patch.costStructure || "").trim(),
      aiNotes: String(patch.aiNotes || "").trim(),
      logoUrl,
      updatedAt: Date.now(),
      updatedBy,
    },
    { merge: true },
  );
  cacheBrandLogo(logoUrl);
}

/** แปลงโปรไฟล์เป็นข้อความให้โมเดล AI อ่าน */
export function formatBusinessProfileForAi(profile: BusinessProfile): string {
  const lines = [
    "บริบทกิจการ (โปรไฟล์ร้าน — ใช้ประกอบการจัดประเภท):",
    `- ประเภทกิจการ: ${profile.businessType || "-"}`,
    `- สินค้า/บริการ: ${profile.productsServices || "-"}`,
    `- ควรเป็นต้นทุน (cogs): ${profile.cogsExamples || "-"}`,
    `- ควรเป็นค่าใช้จ่าย (sga): ${profile.sgaExamples || "-"}`,
    `- ควรเป็นสินทรัพย์ (asset): ${profile.assetExamples || "-"}`,
    `- ชั่วโมงเปิด: ${profile.openHours || "-"}`,
    `- โครงสร้างต้นทุน: ${profile.costStructure || "-"}`,
  ];
  if (profile.aiNotes.trim()) {
    lines.push(`- หมายเหตุเพิ่ม: ${profile.aiNotes.trim()}`);
  }
  return lines.join("\n");
}
