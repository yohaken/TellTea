import type { Metadata, Viewport } from "next";
import { Poppins, Sarabun } from "next/font/google";
import { AppRootProviders } from "@/components/AppRootProviders";
import "./globals.css";

const display = Poppins({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Sarabun({
  variable: "--font-body",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TellTea — บัญชีร้าน",
  description: "บัญชีเข้า–ออก TellTea — เจ้าของโอนเข้า พนักงานบันทึกเงินออก",
  icons: {
    icon: "/logo-mark.svg",
    apple: "/logo-mark.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TellTea",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f6b4f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className={`${display.variable} ${body.variable} antialiased`}>
        <AppRootProviders>{children}</AppRootProviders>
      </body>
    </html>
  );
}
