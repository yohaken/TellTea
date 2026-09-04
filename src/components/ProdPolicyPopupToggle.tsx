"use client";

import { useState } from "react";
import { ChefHat } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import { saveProdPolicy, type ProdPolicySettings } from "@/lib/prod-policy";

export function ProdPolicyPopupToggle({
  policy,
  actorId,
  onError,
  compact = false,
}: {
  policy: ProdPolicySettings;
  actorId: string;
  onError: (msg: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!actorId || busy) return;
    setBusy(true);
    try {
      await saveProdPolicy({ popupEnabled: !policy.popupEnabled }, actorId, { asOwner: true });
    } catch (err) {
      onError((err as Error).message || "บันทึกการแสดงป๊อปอัปไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const control = (
    <label className={compact ? "prod-policy-popup-toggle is-compact" : "prod-policy-popup-toggle"}>
      <input
        type="checkbox"
        checked={policy.popupEnabled}
        disabled={busy || !actorId}
        onChange={() => void toggle()}
      />
      <span className="prod-policy-popup-toggle-copy">
        <strong>แสดงป๊อปอัปนโยบาย</strong>
        <span>
          {policy.popupEnabled ? "เปิด — เด้งเมื่อเข้าหน้าผลิต" : "ปิด — ไม่เด้งอัตโนมัติ"}
        </span>
      </span>
    </label>
  );

  if (compact) return control;

  return (
    <SettingsFold
      title={
        <>
          <ChefHat size={18} aria-hidden />
          นโยบายผลิต
        </>
      }
      hint="ป๊อปอัปเมื่อเข้าหน้าผลิต · ขั้นต่ำต่อวันและ % ทิ้งตั้งที่หน้าผลิต"
      defaultOpen={false}
    >
      {control}
    </SettingsFold>
  );
}
