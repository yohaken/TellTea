import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TellTea POS",
  description: "เครื่อง POS หน้าร้าน — Phase 0 เชื่อมต่อและส่งสัญญาณ",
  appleWebApp: {
    capable: true,
    title: "TellTea POS",
  },
};

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
