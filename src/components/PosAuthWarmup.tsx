"use client";

import { useEffect } from "react";
import { isFirebaseConfigured } from "@/lib/firebase";
import { warmPosAuth } from "@/lib/pos-auth";
import { getPosDb } from "@/lib/pos-firebase";

/** Start Firebase auth + Firestore restore before POS page boot(). */
export function PosAuthWarmup() {
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    warmPosAuth();
    void getPosDb();
  }, []);
  return null;
}
