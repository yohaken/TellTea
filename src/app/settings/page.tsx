"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { AppUpdateSetup } from "@/components/AppUpdateSetup";
import { BusinessProfileSetup } from "@/components/BusinessProfileSetup";
import { MenuCatalogSetup } from "@/components/MenuCatalogSetup";
import { PosSalesSetup } from "@/components/PosSalesSetup";
import { PosPaymentSetup } from "@/components/PosPaymentSetup";
import { PosShopInfoSetup } from "@/components/PosShopInfoSetup";
import { PosPrinterSetup } from "@/components/PosPrinterSetup";
import { PosDeviceSetup } from "@/components/PosDeviceSetup";
import { AuthGate } from "@/components/AuthGate";
import { ChecklistSetup } from "@/components/ChecklistSetup";
import { NavMenuOrderSetup } from "@/components/NavMenuOrderSetup";
import { OtBonusRateSetup } from "@/components/OtBonusRateSetup";
import { ProdCatalogSetup } from "@/components/ProdCatalogSetup";
import { StockCatalogSetup } from "@/components/StockCatalogSetup";
import { useAuth } from "@/lib/auth";
import { seedChecklistItemsIfEmpty } from "@/lib/checklist";
import { getOtSettings } from "@/lib/ot";
import { listProdProducts, seedProdCatalogIfEmpty, type ProdProduct } from "@/lib/production";

export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsView />
    </AuthGate>
  );
}

function SettingsView() {
  const { actorId, staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const [products, setProducts] = useState<ProdProduct[]>([]);
  const [bonusRate, setBonusRate] = useState(0.6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [p, ot] = await Promise.all([listProdProducts(), getOtSettings()]);
    setProducts(p);
    setBonusRate(ot.bonusRate);
  }

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
    setLoading(true);
    void reload()
      .then(async () => {
        const seeded = await seedProdCatalogIfEmpty();
        if (seeded.products || seeded.workers) await reload();
      })
      .catch((err) => setError((err as Error).message || "โหลดตั้งค่าไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [isOwner]);

  if (!isOwner) return null;

  return (
    <div>
      <h1 className="panel-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <Settings size={20} aria-hidden />
        ตั้งค่าโมดูล
      </h1>
      <p className="muted" style={{ marginBottom: "1rem", textAlign: "left" }}>
        จัดการค่าเริ่มต้นของผลิต · ชง · SmartCheck · คลัง · โปรไฟล์กิจการ (AI) · ลำดับเมนู — เฉพาะเจ้าของ
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="owner-settings-stack">
          <BusinessProfileSetup onError={setError} />
          <AppUpdateSetup onError={setError} />
          <PosDeviceSetup onError={setError} />
          <PosShopInfoSetup onError={setError} />
          <p className="muted" style={{ margin: "-0.35rem 0 0.75rem", fontSize: "0.82rem" }}>
            บนแท็บเล็ต POS แก้ได้เร็วที่เมนู &quot;ตั้งค่ากิจการ&quot;
          </p>
          <PosSalesSetup onError={setError} />
          <PosPaymentSetup onError={setError} />
          <PosPrinterSetup onError={setError} />
          <MenuCatalogSetup onError={setError} />
          <NavMenuOrderSetup onError={setError} />
          <ProdCatalogSetup
            products={products}
            onReload={() => void reload().catch((err) => setError((err as Error).message))}
            onError={setError}
          />
          <OtBonusRateSetup
            bonusRate={bonusRate}
            createdBy={actorId}
            onReload={() => void reload().catch((err) => setError((err as Error).message))}
            onError={setError}
          />
          <ChecklistSetup
            onReload={() => void reloadChecklist().catch((err) => setError((err as Error).message))}
            onError={setError}
          />
          <StockCatalogSetup onError={setError} />
        </div>
      ) : null}
    </div>
  );
}
