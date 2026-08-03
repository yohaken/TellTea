"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { StaffUtilityPanel } from "@/components/StaffUtilityPanel";

/**
 * ไอคอนยูทิลิตี้ซ้ายกลางจอ — เฉพาะพนักงาน (ไม่โชว์มุมเจ้าของ)
 * กดปิดแผง = ปิดทันที · เจ้าของใช้หน้าโมดูล `/utility/` แทน
 */
export function StaffUtilityDock() {
  const pathname = usePathname();
  const { staff, status } = useAuth();
  const isOwner = staff?.role === "owner";
  const [open, setOpen] = useState(false);

  const ready = status === "ready" && !!staff && !isOwner;
  useBodyScrollLock(open);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function closePanel() {
    setOpen(false);
  }

  if (!ready) return null;
  if (pathname.startsWith("/pos")) return null;
  if (pathname.startsWith("/utility")) return null;

  return (
    <>
      <button
        type="button"
        className="staff-utility-fab"
        aria-label="ยูทิลิตี้ · ข้อเสนอและกระดานโนต"
        title="ข้อเสนอ · กระดานโนต"
        onClick={() => setOpen(true)}
      >
        <Sparkles size={18} strokeWidth={2.25} aria-hidden />
      </button>

      {open ? (
        <div
          className="modal-backdrop staff-utility-backdrop"
          role="presentation"
          onClick={closePanel}
        >
          <div
            className="modal-card staff-utility-panel"
            role="dialog"
            aria-modal="true"
            aria-label="ยูทิลิตี้พนักงาน"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="staff-utility-head">
              <div>
                <h2>ยูทิลิตี้</h2>
                <p className="muted">ของเล็กๆ · ไม่แย่งแถบล่าง</p>
              </div>
              <button
                type="button"
                className="ghost-btn icon-btn"
                aria-label="ปิด"
                onClick={closePanel}
              >
                <X size={18} />
              </button>
            </header>

            <StaffUtilityPanel />
          </div>
        </div>
      ) : null}
    </>
  );
}
