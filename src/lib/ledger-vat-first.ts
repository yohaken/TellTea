/**
 * VAT-first flow for cash-out / bill create:
 * /ledger/ บันทึกเงินออก, /owner-books/ โอนออก, แจ้งบิล (add only).
 * Not used for transfer-in / edit.
 */

export type VatFirstPhase =
  | "ask"
  | "upload"
  | "confirm_ai"
  | "manual"
  | "form";

/** Everyone creating cash-out on staff ledger starts at the VAT ask. */
export function initialVatFirstPhase(_isOwner?: boolean): VatFirstPhase {
  return "ask";
}

export function phaseAfterVatAsk(hasVatDocument: boolean): VatFirstPhase {
  return hasVatDocument ? "upload" : "form";
}

/** After AI extract finishes in VAT-first upload step. */
export function phaseAfterAiVatExtract(vatInput: number | null | undefined): VatFirstPhase {
  const n = Number(vatInput);
  if (Number.isFinite(n) && n > 0) return "confirm_ai";
  return "manual";
}

/** Detail fields (date/desc/amount/type) unlocked only on the form step. */
export function vatFirstDetailsUnlocked(phase: VatFirstPhase): boolean {
  return phase === "form";
}

/** Save only when VAT path is resolved (no VAT, or verified amount). */
export function vatFirstReadyToSave(opts: {
  phase: VatFirstPhase;
  hasVat: boolean;
  vatVerified: boolean;
  vatInput: number;
}): boolean {
  if (opts.phase !== "form") return false;
  if (!opts.hasVat) return true;
  return opts.vatVerified && opts.vatInput > 0;
}

/** @deprecated use vatFirstReadyToSave — kept for older imports/tests */
export function staffVatReadyToSave(opts: {
  isOwner?: boolean;
  phase: VatFirstPhase;
  hasVat: boolean;
  vatVerified: boolean;
  vatInput: number;
}): boolean {
  return vatFirstReadyToSave(opts);
}
