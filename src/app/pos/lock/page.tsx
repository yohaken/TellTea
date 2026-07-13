"use client";

import { useEffect } from "react";
import { usePosApp } from "@/lib/pos-app-context";

export default function PosLockPage() {
  const { setLocked } = usePosApp();

  useEffect(() => {
    setLocked(true);
  }, [setLocked]);

  return null;
}
