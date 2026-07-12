"use client";

export type CheckTab = "check" | "summary" | "setup";

export function CheckTabDock({
  tab,
  isOwner,
  onSelect,
}: {
  tab: CheckTab;
  isOwner: boolean;
  onSelect: (tab: CheckTab) => void;
}) {
  return (
    <div
      className={isOwner ? "module-tab-dock" : "module-tab-dock is-dual"}
      role="tablist"
      aria-label="มุมมอง SmartCheck"
    >
      <button
        type="button"
        role="tab"
        className={tab === "check" ? "module-tab is-add is-active" : "module-tab is-add"}
        aria-selected={tab === "check"}
        onClick={() => onSelect("check")}
      >
        เช็ค
      </button>
      <button
        type="button"
        role="tab"
        className={tab === "summary" ? "module-tab is-table is-active" : "module-tab is-table"}
        aria-selected={tab === "summary"}
        onClick={() => onSelect("summary")}
      >
        ภาพรวม
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
