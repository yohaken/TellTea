"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AppUpdateWatcher } from "@/components/AppUpdateWatcher";
import { AuthProvider } from "@/lib/auth";
import { installChunkLoadRecovery } from "@/lib/chunk-load-recovery";

/** Back-office auth/update only — POS routes skip this entirely. */
export function AppRootProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");

  useEffect(() => {
    if (isPos) return;
    return installChunkLoadRecovery();
  }, [isPos]);

  if (isPos) {
    return children;
  }

  return (
    <AuthProvider>
      <AppUpdateWatcher />
      {children}
    </AuthProvider>
  );
}
