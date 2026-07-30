import { doc, setDoc } from "firebase/firestore";
import { getMenuDb } from "./pos-menu-db";

/**
 * Bump menuVersion so open nPos tablets reload the full menu snapshot.
 * Best-effort — never blocks the menu save.
 */
export async function bumpMenuVersion(): Promise<void> {
  try {
    await setDoc(
      doc(getMenuDb(), "meta", "pos"),
      { menuVersion: Date.now() },
      { merge: true },
    );
  } catch {
    /* ignore */
  }
}
