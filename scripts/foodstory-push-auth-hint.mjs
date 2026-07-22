#!/usr/bin/env node
/**
 * ดัน session.json (idKey/branchId) ขึ้น meta ผ่าน callable — ต้องล็อกอิน owner ในเบราว์เซอร์ไม่ได้จาก CLI ตรงๆ
 *
 * ใช้จาก local หลัง capture:
 *   เปิดหลังร้าน → จัดการ Pos → ระบบซิงก์ → วาง idKey/branchId จาก
 *   scripts/data/foodstory-auth/session.json แล้วกดบันทึก
 *
 * สคริปต์นี้พิมพ์ค่าพร้อมใช้วาง (ไม่พิมพ์ idKey เต็มลง log ถ้า --mask)
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const sessionPath = join(__dir, "data/foodstory-auth/session.json");
const MASK = process.argv.includes("--mask");

if (!existsSync(sessionPath)) {
  console.error("ไม่พบ", sessionPath);
  process.exit(2);
}

const session = JSON.parse(readFileSync(sessionPath, "utf8"));
const idKey = session.idKey || session.accessToken || "";
const branchId = session.branchId || session.branch_id || "";

console.log("=== FoodStory auth สำหรับแผงหลังร้าน ===");
console.log("branchId:", branchId || "(ว่าง)");
console.log(
  "idKey:",
  MASK && idKey ? `${idKey.slice(0, 6)}…${idKey.slice(-4)} (ยาว ${idKey.length})` : idKey || "(ว่าง)",
);
console.log("");
console.log("ไปที่: หลังร้าน → รายงานยอดขาย POS → จัดการ Pos → ระบบซิงก์เมนู");
console.log("วางค่าแล้วกด「บันทึกเซสชัน」จากนั้น「ซิงก์เมนูตอนนี้」");
