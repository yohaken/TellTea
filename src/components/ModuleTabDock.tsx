"use client";

export function ModuleTabDock({
  ariaLabel,
  formOpen,
  onAdd,
  addLabel = "+ กรอก",
}: {
  ariaLabel: string;
  formOpen?: boolean;
  onAdd: () => void;
  addLabel?: string;
}) {
  return (
    <div className="module-tab-dock is-single" role="tablist" aria-label={ariaLabel}>
      <button
        type="button"
        role="tab"
        className={formOpen ? "module-tab is-add is-active" : "module-tab is-add"}
        aria-selected={!!formOpen}
        onClick={onAdd}
      >
        {addLabel}
      </button>
    </div>
  );
}
