"use client";

export type ModuleTab = "form" | "table" | "setup";

export function ModuleTabDock({
  tab,
  isOwner,
  ariaLabel,
  onSelect,
}: {
  tab: ModuleTab;
  isOwner: boolean;
  ariaLabel: string;
  onSelect: (tab: ModuleTab) => void;
}) {
  return (
    <div
      className={isOwner ? "module-tab-dock" : "module-tab-dock is-staff"}
      role="tablist"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        role="tab"
        className={tab === "form" ? "module-tab is-active" : "module-tab"}
        aria-selected={tab === "form"}
        onClick={() => onSelect("form")}
      >
        กรอก
      </button>
      <button
        type="button"
        role="tab"
        className={tab === "table" ? "module-tab is-active" : "module-tab"}
        aria-selected={tab === "table"}
        onClick={() => onSelect("table")}
      >
        ตาราง
      </button>
      {isOwner ? (
        <button
          type="button"
          role="tab"
          className={tab === "setup" ? "module-tab is-active" : "module-tab"}
          aria-selected={tab === "setup"}
          onClick={() => onSelect("setup")}
        >
          ตั้งค่า
        </button>
      ) : null}
    </div>
  );
}
