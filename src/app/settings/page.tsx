"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { AppUpdateSetup } from "@/components/AppUpdateSetup";
import { BusinessProfileSetup } from "@/components/BusinessProfileSetup";
import { MenuCatalogSetup } from "@/components/MenuCatalogSetup";
import { PosAutoPrintSetup } from "@/components/PosAutoPrintSetup";
import { PosPaymentSetup } from "@/components/PosPaymentSetup";
import { PosShopInfoSetup } from "@/components/PosShopInfoSetup";
import { PosPrinterSetup } from "@/components/PosPrinterSetup";
import { PosDeviceSetup } from "@/components/PosDeviceSetup";
import { PosOpsNotesSetup } from "@/components/PosOpsNotesSetup";
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

function SettingsGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <header className="settings-group-head">
        <h2 className="settings-group-title">{title}</h2>
        <p className="muted settings-group-hint">{hint}</p>
      </header>
      <div className="settings-group-body">{children}</div>
    </section>
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
        จัดกลุ่มตามงาน: ร้าน · อัปเดต · POS · โมดูล — เฉพาะเจ้าของ · รายงานยอดขายอยู่ที่เมนูอื่น ๆ
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <div className="owner-settings-stack">
          <SettingsGroup title="ร้าน & AI" hint="โลโก้ · โปรไฟล์ให้ AI อ่านบัญชี · ชื่อที่อยู่บนสลิป">
            <BusinessProfileSetup onError={setError} />
            <PosShopInfoSetup onError={setError} />
            <p className="muted settings-group-note">
              บนแท็บเล็ต POS แก้ชื่อร้าน/PromptPay ได้เร็วที่เมนู &quot;ตั้งค่ากิจการ&quot;
            </p>
          </SettingsGroup>

          <SettingsGroup title="อัปเดต" hint="วิธีแจ้งเมื่อมีเวอร์ชันใหม่ — โหมดเดียวแทนสวิตช์แยก">
            <AppUpdateSetup onError={setError} />
          </SettingsGroup>

          <SettingsGroup title="POS" hint="ชำระเงิน · พิมพ์หลังขาย · เครื่องพิมพ์ · เมนูขาย · อุปกรณ์">
            <PosPaymentSetup onError={setError} />
            <PosAutoPrintSetup onError={setError} />
            <PosPrinterSetup onError={setError} />
            <MenuCatalogSetup onError={setError} />
            <PosDeviceSetup onError={setError} />
            <PosOpsNotesSetup onError={setError} />
          </SettingsGroup>

          <SettingsGroup title="โมดูลงาน" hint="แถบเมนู · ผลิต · ชง · SmartCheck · คลัง">
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
          </SettingsGroup>
        </div>
      ) : null}
    </div>
  );
}
