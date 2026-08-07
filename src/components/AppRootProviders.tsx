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
  /** Public QR signup / receipt claim — no staff auth shell */
  const isPublicJoin = pathname === "/join" || pathname.startsWith("/join/");
  const isPublicClaim = pathname === "/claim" || pathname.startsWith("/claim/");
  const isPublicMemberMe = pathname === "/me" || pathname.startsWith("/me/");
  const skipBoAuth = isPos || isPublicJoin || isPublicClaim || isPublicMemberMe;

  useEffect(() => {
    if (skipBoAuth) return;
    return installChunkLoadRecovery();
  }, [skipBoAuth]);

  if (skipBoAuth) {
    return children;
  }

  return (
    <AuthProvider>
      <AppUpdateWatcher />
      {children}
    </AuthProvider>
  );
}
