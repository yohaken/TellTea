"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { BusinessLogoField } from "@/components/BusinessLogoField";
import { SettingsFold } from "@/components/SettingsFold";
import { useAuth } from "@/lib/auth";
import { loadBrandLogo } from "@/lib/brand-logo";
import {
  DEFAULT_BUSINESS_PROFILE,
  ensureBusinessProfileSeeded,
  getBusinessProfile,
  saveBusinessProfile,
  type BusinessProfile,
} from "@/lib/business-profile";

type Props = {
  onError: (msg: string | null) => void;
};

/** โปรไฟล์กิจการในตั้งค่าโมดูล — AI จัดประเภทบัญชีอ่านค่านี้ */
export function BusinessProfileSetup({ onError }: Props) {
  const { actorId } = useAuth();
  const [profile, setProfile] = useState<BusinessProfile>({ ...DEFAULT_BUSINESS_PROFILE });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Migrate fat legacy logos off businessProfile (if any) without blocking the form.
        void loadBrandLogo();
        const seeded = await ensureBusinessProfileSeeded(actorId || "owner");
        if (!cancelled) setProfile(seeded);
      } catch {
        try {
          const p = await getBusinessProfile();
          if (!cancelled) setProfile(p);
        } catch (err) {
          if (!cancelled) onError((err as Error).message || "โหลดโปรไฟล์กิจการไม่สำเร็จ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorId, onError]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    onError(null);
    try {
      await saveBusinessProfile(
        {
          businessType: profile.businessType,
          productsServices: profile.productsServices,
          cogsExamples: profile.cogsExamples,
          sgaExamples: profile.sgaExamples,
          assetExamples: profile.assetExamples,
          openHours: profile.openHours,
          costStructure: profile.costStructure,
          aiNotes: profile.aiNotes,
          logoUrl: profile.logoUrl === "brandLogo" || profile.logoUrl ? "brandLogo" : "",
        },
        actorId || "owner",
      );
      setMsg("บันทึกโปรไฟล์กิจการแล้ว — AI จะใช้ตอนจัดประเภทบัญชี");
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function patch<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <SettingsFold
      title={
        <>
          <Building2 size={18} aria-hidden />
          โปรไฟล์กิจการ (ให้ AI อ่าน)
        </>
      }
      hint="บริบทร้านสำหรับจัดประเภทบัญชีอัตโนมัติ — ไม่ใช่ข้อมูลสลิป POS"
      defaultOpen={false}
      className="business-profile-card"
    >
      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="business-profile-form" onSubmit={(e) => void onSave(e)}>
          <BusinessLogoField
            value={profile.logoUrl}
            onChange={(logoUrl) => patch("logoUrl", logoUrl)}
            onError={(m) => onError(m || null)}
            disabled={busy}
          />

          <label>
            <span>ประเภทกิจการ</span>
            <input
              value={profile.businessType}
              onChange={(e) => patch("businessType", e.target.value)}
              required
            />
          </label>
          <label>
            <span>สินค้า / บริการหลัก</span>
            <textarea
              value={profile.productsServices}
              onChange={(e) => patch("productsServices", e.target.value)}
              rows={2}
            />
          </label>
          <label>
            <span>ควรเป็นต้นทุน (cogs)</span>
            <textarea
              value={profile.cogsExamples}
              onChange={(e) => patch("cogsExamples", e.target.value)}
              rows={3}
            />
          </label>
          <label>
            <span>ควรเป็นค่าใช้จ่าย (sga)</span>
            <textarea
              value={profile.sgaExamples}
              onChange={(e) => patch("sgaExamples", e.target.value)}
              rows={3}
            />
          </label>
          <label>
            <span>ควรเป็นสินทรัพย์ (asset)</span>
            <textarea
              value={profile.assetExamples}
              onChange={(e) => patch("assetExamples", e.target.value)}
              rows={2}
            />
          </label>
          <label>
            <span>ชั่วโมงเปิดทำการ</span>
            <input value={profile.openHours} onChange={(e) => patch("openHours", e.target.value)} />
          </label>
          <label>
            <span>โครงสร้างต้นทุนโดยประมาณ</span>
            <textarea
              value={profile.costStructure}
              onChange={(e) => patch("costStructure", e.target.value)}
              rows={2}
            />
          </label>
          <label>
            <span>หมายเหตุเพิ่มให้ AI</span>
            <textarea
              value={profile.aiNotes}
              onChange={(e) => patch("aiNotes", e.target.value)}
              rows={2}
            />
          </label>

          <div className="settings-card-actions">
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() =>
                setProfile((prev) => ({
                  ...DEFAULT_BUSINESS_PROFILE,
                  logoUrl: prev.logoUrl,
                }))
              }
            >
              คืนค่าเริ่มต้น TellTea
            </button>
          </div>
          {msg ? <p className="ledger-ai-settings-msg">{msg}</p> : null}
        </form>
      ) : null}
    </SettingsFold>
  );
}
