"use client";

import { PosAppProvider } from "@/lib/pos-app-context";
import { PosRootLayout } from "@/components/PosRootLayout";

export function PosClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <PosAppProvider>
      <PosRootLayout>{children}</PosRootLayout>
    </PosAppProvider>
  );
}
