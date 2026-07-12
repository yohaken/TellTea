"use client";

export function ModuleTabDock({
  setupActive,
  isOwner,
  ariaLabel,
  formOpen,
  onAdd,
  onSetup,
}: {
  setupActive: boolean;
  isOwner: boolean;
  ariaLabel: string;
  formOpen?: boolean;
  onAdd: () => void;
  onSetup: () => void;
}) {
  return (
    <div
      className={isOwner ? "module-tab-dock is-dual" : "module-tab-dock is-single"}
      role="tablist"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        role="tab"
        className={formOpen ? "module-tab is-add is-active" : "module-tab is-add"}
        aria-selected={!!formOpen}
        onClick={onAdd}
      >
        + กรอก
      </button>
      {isOwner ? (
        <button
          type="button"
          role="tab"
          className={setupActive && !formOpen ? "module-tab is-setup is-active" : "module-tab is-setup"}
          aria-selected={setupActive && !formOpen}
          onClick={onSetup}
        >
          ตั้งค่า
        </button>
      ) : null}
    </div>
  );
}
