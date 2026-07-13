"use client";

import { useEffect } from "react";

export default function PosIndexPage() {
  useEffect(() => {
    window.location.replace("/pos/sell/");
  }, []);
  return (
    <main className="pos-page-center">
      <p className="muted">กำลังไปหน้าขาย...</p>
    </main>
  );
}
