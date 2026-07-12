"use client";

import { useEffect } from "react";

let lockCount = 0;

/** Prevent background scroll while a modal/popup is open (supports nested modals). */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockCount += 1;
    document.body.classList.add("modal-open");
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.classList.remove("modal-open");
      }
    };
  }, [active]);
}
