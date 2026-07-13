"use client";

import { usePathname } from "next/navigation";
import { AppUpdateWatcher } from "@/components/AppUpdateWatcher";
import { AuthProvider } from "@/lib/auth";

/** Back-office auth/update only — POS routes skip this entirely. */
export function AppRootProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/");

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
