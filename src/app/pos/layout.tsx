import type { Metadata, Viewport } from "next";
import { PosAuthWarmup } from "@/components/PosAuthWarmup";
import { PosClientLayout } from "@/components/PosClientLayout";

export const metadata: Metadata = {
  title: "TellTea POS",
  description: "เครื่อง POS หน้าร้าน — TellTea",
  manifest: "/manifest-pos.webmanifest",
  icons: {
    icon: [
      { url: "/icons/pos-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pos-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/pos-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "TellTea POS",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#2a3038",
};

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PosAuthWarmup />
      <PosClientLayout>{children}</PosClientLayout>
    </>
  );
}
