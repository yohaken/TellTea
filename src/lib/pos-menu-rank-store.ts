/**
 * Subscribe + cache meta/posMenuRank for web sell sorting.
 */
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getPosDb } from "./pos-firebase";
import type { PosMenuRankTable } from "./pos-bestseller-rank";
import { normalizeWindowDays } from "./pos-bestseller-rank";

type Listener = (table: PosMenuRankTable | null) => void;
const listeners = new Set<Listener>();
let cached: PosMenuRankTable | null = null;
let unsub: Unsubscribe | null = null;

function mapRank(data: Record<string, unknown> | undefined): PosMenuRankTable | null {
  if (!data) return null;
  return {
    windowDays: normalizeWindowDays(data.windowDays),
    computedAt: typeof data.computedAt === "number" ? data.computedAt : 0,
    categories: Array.isArray(data.categories)
      ? (data.categories as PosMenuRankTable["categories"])
      : [],
    items: Array.isArray(data.items) ? (data.items as PosMenuRankTable["items"]) : [],
  };
}

function ensureSub() {
  if (unsub || typeof window === "undefined") return;
  unsub = onSnapshot(
    doc(getPosDb(), "meta", "posMenuRank"),
    (snap) => {
      cached = mapRank(snap.data() as Record<string, unknown> | undefined);
      for (const fn of listeners) {
        try {
          fn(cached);
        } catch {
          /* ignore */
        }
      }
    },
    () => {
      /* keep last cache */
    },
  );
}

export function getCachedPosMenuRank(): PosMenuRankTable | null {
  return cached;
}

export function subscribePosMenuRank(listener: Listener): () => void {
  ensureSub();
  listeners.add(listener);
  listener(cached);
  return () => listeners.delete(listener);
}
