/**
 * Staff VAT-first flow for ledger cash-out create (not bill notices).
 * Owner skips this and uses the normal form.
 */

export type VatFirstPhase =
  | "ask"
  | "upload"
  | "confirm_ai"
  | "manual"
  | "form";

/** Staff starts at ask; owner goes straight to the form. */
export function initialVatFirstPhase(isOwner: boolean): VatFirstPhase {
  return isOwner ? "form" : "ask";
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

/** Staff may save only when VAT path is resolved (no VAT, or verified amount). */
export function staffVatReadyToSave(opts: {
  isOwner: boolean;
  phase: VatFirstPhase;
  hasVat: boolean;
  vatVerified: boolean;
  vatInput: number;
}): boolean {
  if (opts.isOwner) return true;
  if (opts.phase !== "form") return false;
  if (!opts.hasVat) return true;
  return opts.vatVerified && opts.vatInput > 0;
}
