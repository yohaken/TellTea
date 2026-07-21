"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { AppUpdateSetup } from "@/components/AppUpdateSetup";
import { BusinessProfileSetup } from "@/components/BusinessProfileSetup";
import { AuthGate } from "@/components/AuthGate";
import { ChecklistSetup } from "@/components/ChecklistSetup";
import { NavMenuOrderSetup } from "@/components/NavMenuOrderSetup";
import { useAuth } from "@/lib/auth";
import { seedChecklistItemsIfEmpty } from "@/lib/checklist";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsView />
    </AuthGate>
  );
}

function SettingsView() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reloadChecklist() {
    await seedChecklistItemsIfEmpty();
  }

  useEffect(() => {
    if (staff && !isOwner) {
      router.replace("/more/");
    }
  }, [staff, isOwner, router]);

  useEffect(() => {
    if (!isOwner) return;
    setLoading(false);
  }, [isOwner]);

  if (!isOwner) return null;

  return (
    <div>
      <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Settings size={20} aria-hidden />
        ตั้งค่าโมดูล
      </h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        SmartCheck · โปรไฟล์กิจการ (AI) · ลำดับเมนู · อัปเดตแอป — เฉพาะเจ้าของ
        (ตั้งค่า POS อยู่ที่ POS → จัดการ Pos · คลังอยู่หน้า คลัง · สินค้าผลิตอยู่หน้า ผลิต · เรทโบนัสอยู่หน้า สรุปโบนัส)
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="owner-settings-stack">
          <BusinessProfileSetup onError={setError} />
          <AppUpdateSetup onError={setError} />
          <NavMenuOrderSetup onError={setError} />
          <ChecklistSetup
            onReload={() => void reloadChecklist().catch((err) => setError((err as Error).message))}
            onError={setError}
          />
        </div>
      ) : null}
    </div>
  );
}
