/**
 * แคตตาล็อกมินิเกมคูณแต้ม — ลูกค้าเลือกได้เพียง 1 เกมต่อรอบ
 *
 * สำคัญ: ปิดฝั่งลูกค้าจนกว่าเจ้าของตรวจหลังร้านผ่านแล้ว
 * เปิดจริง = เปลี่ยนค่านี้เป็น true หลังยืนยันที่ /members/spin-demo/
 *
 * × ในเกม = คูณแต้มเท่านั้น ไม่ใช่ของแถม/สินค้า
 */
export const POINTS_GAMES_CUSTOMER_LIVE = false;

export type PointsGameId = "spin" | "feed" | "pour";

export type PointsGameInfo = {
  id: PointsGameId;
  title: string;
  shortTitle: string;
  blurb: string;
  attractLine: string;
};

export const POINTS_GAMES: readonly PointsGameInfo[] = [
  {
    id: "spin",
    title: "หมุนวงล้อคูณแต้ม",
    shortTitle: "หมุนวงล้อ",
    blurb: "หมุนวงกลม · กดหยุดลุ้นคูณแต้ม ×1–×5",
    attractLine: "วงล้อกำลังหมุน…",
  },
  {
    id: "feed",
    title: "ป้อนไข่มุกลุ้นแต้ม",
    shortTitle: "ป้อนไข่มุก",
    blurb: "แตะตอนไข่มุกอยู่โซน · ได้คูณแต้ม ไม่ใช่ของแถม",
    attractLine: "ไข่มุกกำลังโยก…",
  },
  {
    id: "pour",
    title: "เทชาลุ้นคูณแต้ม",
    shortTitle: "เทชา",
    blurb: "กดค้างเทชา · ปล่อยตอนโซนคูณแต้มที่อยากได้",
    attractLine: "กำลังเทชา…",
  },
] as const;

export function pointsGameById(id: PointsGameId): PointsGameInfo {
  return POINTS_GAMES.find((g) => g.id === id) || POINTS_GAMES[0]!;
}
