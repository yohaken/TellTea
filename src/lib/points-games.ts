/**
 * เกมลุ้นแต้ม — เหลือเกมเดียว: หมุนวงล้อ
 *
 * เปิด/ปิดจริงอยู่ที่ meta/pointsSpinSettings.gamesEnabled (หลังร้าน /members/spin-demo)
 * ค่านี้เป็น kill-switch ฉุกเฉินฝั่ง build เท่านั้น — ปกติปล่อย false แล้วใช้ธงใน Firestore
 *
 * ได้ 0–5 แต้ม (0 = ไม่ได้เพิ่ม) · ไม่ใช่ของแถม · ไม่ใช่ตัวคูณแต้มฐาน
 */
export const POINTS_GAMES_KILL_SWITCH = false;

/** @deprecated ใช้ isPointsGameEnabled(settings) จาก points-spin-settings แทน */
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
    blurb: "หมุนวงกลม · กดหยุดให้หน่วงเอง · ได้ 0–5 แต้ม",
    attractLine: "วงล้อกำลังหมุน…",
  },
] as const;

export function pointsGameById(id: PointsGameId): PointsGameInfo {
  return POINTS_GAMES.find((g) => g.id === id) || POINTS_GAMES[0]!;
}
