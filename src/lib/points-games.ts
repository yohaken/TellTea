/**
 * เกมลุ้นแต้ม — เหลือเกมเดียว: หมุนวงล้อ
 *
 * สำคัญ: ปิดฝั่งลูกค้าจนกว่าเจ้าของตรวจหลังร้านผ่านแล้ว
 * เปิดจริง = เปลี่ยนค่านี้เป็น true หลังยืนยันที่ /members/spin-demo/
 *
 * ได้แต้มคงที่ 1–5 · ไม่ใช่ของแถม · ไม่ใช่ตัวคูณแต้มฐาน
 */
export const POINTS_GAMES_CUSTOMER_LIVE = false;

export type PointsGameId = "spin";

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
    title: "หมุนวงล้อลุ้นแต้ม",
    shortTitle: "หมุนวงล้อ",
    blurb: "หมุนวงกลม · กดหยุดให้หน่วงเอง · ได้ 1–5 แต้ม",
    attractLine: "วงล้อกำลังหมุน…",
  },
] as const;

export function pointsGameById(id: PointsGameId): PointsGameInfo {
  return POINTS_GAMES.find((g) => g.id === id) || POINTS_GAMES[0]!;
}
