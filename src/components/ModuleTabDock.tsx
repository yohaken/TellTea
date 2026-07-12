"use client";

export function ModuleTabDock({
  ariaLabel,
  formOpen,
  onAdd,
  addLabel = "+ กรอก",
  variant = "default",
}: {
  ariaLabel: string;
  formOpen?: boolean;
  onAdd: () => void;
  addLabel?: string;
  /** default = ปุ่มเขียวทึบ · glass-out = โปร่งใสส้ม (บัญชีเงินออก) */
  variant?: "default" | "glass-out";
}) {
  const tabClass =
    variant === "glass-out"
      ? formOpen
        ? "module-tab is-glass-out is-active"
        : "module-tab is-glass-out"
      : formOpen
        ? "module-tab is-add is-active"
        : "module-tab is-add";

  return (
    <div className="module-tab-dock is-single" role="tablist" aria-label={ariaLabel}>
      <button
        type="button"
        role="tab"
        className={tabClass}
        aria-selected={!!formOpen}
        onClick={onAdd}
      >
        {addLabel}
      </button>
    </div>
  );
}
