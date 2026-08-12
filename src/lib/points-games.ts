/**
 * แคตตาล็อกมินิเกมคูณแต้ม — ลูกค้าเลือกได้เพียง 1 เกมต่อรอบ
 *
 * สำคัญ: ปิดฝั่งลูกค้าจนกว่าเจ้าของตรวจหลังร้านผ่านแล้ว
 * เปิดจริง = เปลี่ยนค่านี้เป็น true หลังยืนยันที่ /members/spin-demo/
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
    title: "หมุนกระดานเมนู",
    shortTitle: "หมุนเมนู",
    blurb: "กดหยุดบนเมนูชา·ขนม · ชิ้นแคบ = × สูง",
    attractLine: "เมนูกำลังหมุน…",
  },
  {
    id: "feed",
    title: "ป้อนไข่มุก",
    shortTitle: "ป้อนไข่มุก",
    blurb: "แตะตอนไข่มุกใกล้ปากหนุ่ม Tell Tea",
    attractLine: "ไข่มุกกำลังโยก…",
  },
  {
    id: "pour",
    title: "เทชาไทยให้พอดี",
    shortTitle: "เทชาไทย",
    blurb: "กดค้างเทชา · ปล่อยตอนระดับที่อยากได้",
    attractLine: "กำลังเทชาไทย…",
  },
] as const;

export function pointsGameById(id: PointsGameId): PointsGameInfo {
  return POINTS_GAMES.find((g) => g.id === id) || POINTS_GAMES[0]!;
}
