"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type Props = {
  title: ReactNode;
  hint?: ReactNode;
  /** ค่าเริ่มต้นเปิดหรือพับ — ยาวๆ แนะนำพับไว้ก่อน */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/** หมวดตั้งค่าที่พับได้ — ใช้ซ้ำในหน้าตั้งค่าโมดูล */
export function SettingsFold({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={`settings-fold${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="settings-fold-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="settings-fold-toggle-left">
          <span className="settings-fold-title">{title}</span>
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open ? (
        <div id={panelId} className="settings-fold-body">
          {hint ? <p className="muted settings-fold-hint">{hint}</p> : null}
          {children}
        </div>
      ) : hint ? (
        <p className="muted settings-fold-hint settings-fold-hint--collapsed">{hint}</p>
      ) : null}
    </section>
  );
}
