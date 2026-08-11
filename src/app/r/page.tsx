"use client";

import { useEffect, useState } from "react";
import { resolveShortReceiptLink } from "@/lib/short-receipt-link";

/**
 * Public short-link landing for slip QR.
 * Hosting rewrites /r/** → this page; we read window.location.pathname.
 */
export default function ShortReceiptLinkPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dest = resolveShortReceiptLink(
      window.location.pathname,
      window.location.search,
    );
    if (dest) {
      window.location.replace(dest);
      return;
    }
    setError("ลิงก์ไม่ครบ สแกน QR จากสลิปอีกครั้งนะ");
  }, []);

  if (!error) {
    return (
      <main className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center px-4 py-10 text-center text-sm text-neutral-600">
        กำลังเปิดลิงก์…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-md flex-col justify-center gap-2 px-4 py-10 text-center">
      <h1 className="text-lg font-semibold text-neutral-900">เปิดลิงก์ไม่ได้</h1>
      <p className="text-sm text-neutral-600">{error}</p>
    </main>
  );
}
