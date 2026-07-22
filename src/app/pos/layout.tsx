import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TellTea POS — ย้ายไป nPos แล้ว",
  description: "เว็บ POS เลิกใช้แล้ว — ขายบนแอป nPos-telltea",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2a3038",
};

/** ไม่ boot device auth / clock-in — หน้า retired อย่างเดียว */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return <div className="pos-web-retired-shell">{children}</div>;
}
