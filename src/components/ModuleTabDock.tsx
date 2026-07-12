"use client";

export type ModuleTab = "form" | "table" | "setup";

export function ModuleTabDock({
  tab,
  isOwner,
  ariaLabel,
  onSelect,
  formOpen,
}: {
  tab: Exclude<ModuleTab, "form">;
  isOwner: boolean;
  ariaLabel: string;
  onSelect: (tab: ModuleTab) => void;
  /** ไฮไลต์ปุ่มกรอกเมื่อ popup เปิดอยู่ */
  formOpen?: boolean;
}) {
  const formActive = !!formOpen;

  return (
    <div
      className={isOwner ? "module-tab-dock" : "module-tab-dock is-staff"}
      role="tablist"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        role="tab"
        className={formActive ? "module-tab is-add is-active" : "module-tab is-add"}
        aria-selected={formActive}
        onClick={() => onSelect("form")}
      >
        + กรอก
      </button>
      <button
        type="button"
        role="tab"
        className={tab === "table" && !formOpen ? "module-tab is-table is-active" : "module-tab is-table"}
        aria-selected={tab === "table" && !formOpen}
        onClick={() => onSelect("table")}
      >
        ตาราง
      </button>
      {isOwner ? (
        <button
          type="button"
          role="tab"
          className={tab === "setup" ? "module-tab is-setup is-active" : "module-tab is-setup"}
          aria-selected={tab === "setup"}
          onClick={() => onSelect("setup")}
        >
          ตั้งค่า
        </button>
      ) : null}
    </div>
  );
}
