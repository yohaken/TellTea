"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { AppUpdateSetup } from "@/components/AppUpdateSetup";
import { BusinessProfileSetup } from "@/components/BusinessProfileSetup";
import { AuthGate } from "@/components/AuthGate";
import { NavMenuOrderSetup } from "@/components/NavMenuOrderSetup";
import { useAuth } from "@/lib/auth";

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
        โปรไฟล์กิจการ · เมนูหลัก · อัปเดตแอป — เฉพาะเจ้าของ · แตะหัวข้อเพื่อพับ/ขยาย
        (SmartCheck อยู่หน้าเช็ค → รายการ SOP · POS เมนูอยู่ที่ POS → จัดการ Pos · คลังอยู่หน้า คลัง ·
        สินค้าผลิตอยู่หน้า ผลิต · เรทโบนัสอยู่หน้า สรุปโบนัส)
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="owner-settings-stack">
          <BusinessProfileSetup onError={setError} />
          <NavMenuOrderSetup onError={setError} />
          <AppUpdateSetup onError={setError} />
        </div>
      ) : null}
    </div>
  );
}
