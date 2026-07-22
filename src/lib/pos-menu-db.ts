import type { Firestore } from "firebase/firestore";
import { getDb } from "./firebase";
import { getPosDb } from "./pos-firebase";
import type { FirestoreErrorHint } from "./firestore-errors";

/** POS device auth vs owner Google auth on telltea-shop */
export type MenuDbMode = "pos" | "owner";

/** ช่องทางราคาเมนู / ตัวเลือก */
export type MenuPriceChannel = "store" | "delivery";

let menuDbMode: MenuDbMode = "pos";

export function setMenuDbMode(mode: MenuDbMode): void {
  menuDbMode = mode;
}

export function getMenuDbMode(): MenuDbMode {
  return menuDbMode;
}

/** Active Firestore app for menu* collections */
export function getMenuDb(): Firestore {
  return menuDbMode === "owner" ? getDb() : getPosDb();
}

export function menuErrorHint(): FirestoreErrorHint {
  return menuDbMode === "owner" ? "staff" : "pos";
}
