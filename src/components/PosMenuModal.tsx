"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function PosMenuModal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pos-menu-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="pos-menu-modal-backdrop" aria-label="ปิด" onClick={onClose} />
      <div className={`pos-menu-modal-panel ${wide ? "is-wide" : ""}`}>
        <header className="pos-menu-modal-head">
          <h2>{title}</h2>
          <button type="button" className="pos-menu-modal-close" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="pos-menu-modal-body">{children}</div>
      </div>
    </div>
  );
}
