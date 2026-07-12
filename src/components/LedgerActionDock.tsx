"use client";

export function LedgerActionDock({
  canTransferIn,
  onAddOut,
  onAddIn,
}: {
  canTransferIn: boolean;
  onAddOut: () => void;
  onAddIn: () => void;
}) {
  return (
    <div
      className={canTransferIn ? "ledger-action-dock" : "ledger-action-dock is-single"}
      role="group"
      aria-label="บันทึกรายการ"
    >
      <button type="button" className="ledger-dock-btn is-out" onClick={onAddOut}>
        บันทึกเงินออก
      </button>
      {canTransferIn ? (
        <button type="button" className="ledger-dock-btn is-in" onClick={onAddIn}>
          โอนเข้า
        </button>
      ) : null}
    </div>
  );
}
