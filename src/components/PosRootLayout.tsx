"use client";

import { usePosApp } from "@/lib/pos-app-context";
import { PosAppShell, PosBootError } from "@/components/PosAppShell";
import { PosLockScreen } from "@/components/PosLockScreen";

export function PosRootLayout({ children }: { children: React.ReactNode }) {
  const { status, locked } = usePosApp();

  if (status === "error") {
    return (
      <div className="pos-shell pos-shell--boot">
        <PosBootError />
      </div>
    );
  }

  if (locked) {
    return <PosLockScreen />;
  }

  if (status !== "ready") {
    return <PosAppShell>{null}</PosAppShell>;
  }

  return <PosAppShell>{children}</PosAppShell>;
}
