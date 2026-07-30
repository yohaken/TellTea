"use client";

/**
 * หน้าเดือนใหม่ — ตามหลักบัญชีร้าน
 * A รายได้ถึงร้าน · B คชจ. · C กำไร+ภ.ง.ด. · D VAT
 * นำเข้าไม่แตะ — รับ sync ผ่าน vat-import-month-sync
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateShort } from "@/lib/utils";
import {
  loadOwnerMonthBreakdown,
  loadPnlReport,
  loadStaffMonthBreakdown,
  saveMonthlyIncome,
  emptyMonthCategoryRow,
  type MonthCategoryRow,
} from "@/lib/pnl";
import {
  computePersonalIncomeTax,
  DEFAULT_PERSONAL_ALLOWANCE,
  loadPersonalTaxSettings,
  savePersonalTaxSettings,
} from "@/lib/personal-income-tax";
import {
  formatVatMoney,
  moneyFieldValue,
  normalizeMoneyFieldText,
  parseVatMoneyInput,
} from "@/lib/vat-number-format";
import {
  deriveMonthBooksView,
  draftToSaveInput,
  emptyMonthBooksDraft,
  incomeBreakdownLabel,
  MONTH_CHANNEL_LABEL,
  MONTH_CHANNEL_SHORT,
  MONTH_CHANNELS,
  patchGpFee,
  patchGpVat,
  patchSales,
  patchSfSendIntoDraft,
  patchTransfer,
  retToMonthBooksDraft,
  type MonthBooksDraft,
  type MonthChannel,
} from "@/lib/vat-month-books";
import {
  bookLabel,
  loadBothBooksVatByMonth,
  type BooksVatBook,
  type BooksVatLine,
} from "@/lib/books-vat-month";
import { updateLedgerEntry } from "@/lib/ledger";
import { updateOwnerBookEntry } from "@/lib/owner-books";
import { BooksVatEntryDetailModal } from "@/components/vat-sales/BooksVatEntryDetailModal";
import { exportPersonalTaxYearXlsx } from "@/lib/xlsx-export";
import {
  fileVatMonthlyReturn,
  formatThaiMonthKey,
  getVatPeriodBoundary,
  listThaiMonthOptions,
  loadVatMonthlyReturn,
  loadVatMonthlySettings,
  saveVatMonthlyReturn,
  unlockVatMonthlyReturn,
  type VatMonthlyReturn,
} from "@/lib/vat-monthly";
import { bangkokMonthKey } from "@/lib/vat-sales";
import { listVatImportRows } from "@/lib/vat-import";
import {
  describeImportIntoBooks,
  previewApplyVatImportRows,
  type ImportIntoBooksMap,
} from "@/lib/vat-import-apply";
import {
  subscribeVatImportMonthMerged,
} from "@/lib/vat-import-month-sync";
import {
  computeNetProfitMarginPct,
  computeRealProfitAfterVat,
  computeSfSendAmount,
  computeSfUnsentAmount,
  loadSfSendPct,
  loadSfSendSource,
  saveSfSendPct,
  saveSfSendSource,
} from "@/lib/vat-storefront-send";

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  return formatVatMoney(n);
}

function pickBookRow(rows: MonthCategoryRow[], month: string): MonthCategoryRow {
  return rows.find((r) => r.month === month) || emptyMonthCategoryRow(month);
}

function bookOpEx(row: MonthCategoryRow | null) {
  if (!row) return null;
  return (row.cogs || 0) + (row.sga || 0) + (row.other || 0);
}

/** รวมภาษีซื้อจากรายการที่ติ๊กรวมเข้างบ */
function sumClaimedBooksVat(lines: BooksVatLine[]) {
  let s = 0;
  for (const l of lines) {
    if (l.vatClaim) s += Number(l.vatInput) || 0;
  }
  return Math.round(s * 100) / 100;
}

function MoneyCell({
  value,
  locked,
  ariaLabel,
  onChange,
  pulse,
}: {
  value: string;
  locked: boolean;
  ariaLabel: string;
  onChange: (v: string) => void;
  pulse?: boolean;
}) {
  return (
    <input
      className={`vat-sales-input${pulse ? " is-sf-pulse" : ""}`}
      inputMode="decimal"
      disabled={locked}
      value={value}
      placeholder="0.00"
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const next = normalizeMoneyFieldText(value);
        if (next !== value) onChange(next);
      }}
    />
  );
}

/** เมื่อติ๊กหักภาษีซื้อ → คชจ.ลดตาม VAT · ยกเลิก → คชจ.คืนบิลเต็ม */
function applyClaimCostDelta(
  row: MonthCategoryRow | null,
  vatDeltaToCost: number,
): MonthCategoryRow | null {
  if (!row || !Number.isFinite(vatDeltaToCost) || vatDeltaToCost === 0) {
    return row;
  }
  return {
    ...row,
    cogs: Math.max(0, Math.round(((row.cogs || 0) + vatDeltaToCost) * 100) / 100),
  };
}

function ExpandBtn({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="vat-expand-btn"
      aria-expanded={open}
      aria-label={`${open ? "ยุบ" : "ขยาย"} ${label}`}
      onClick={onToggle}
    >
      {open ? "−" : "+"}
    </button>
  );
}

type Props = { actor: string };

export function VatMonthBooks({ actor }: Props) {
  const monthOptions = useMemo(() => listThaiMonthOptions(undefined, 18), []);
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [draft, setDraft] = useState<MonthBooksDraft>(() =>
    emptyMonthBooksDraft(bangkokMonthKey()),
  );
  const [periodStartDay, setPeriodStartDay] = useState(1);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const [bookStaff, setBookStaff] = useState<MonthCategoryRow | null>(null);
  const [bookOwner, setBookOwner] = useState<MonthCategoryRow | null>(null);
  const [booksBusy, setBooksBusy] = useState(false);
  const [booksPulledAt, setBooksPulledAt] = useState(0);

  const [booksLines, setBooksLines] = useState<BooksVatLine[]>([]);
  const [openBooksLines, setOpenBooksLines] = useState(false);
  const [booksVatBusy, setBooksVatBusy] = useState(false);
  const [detailLine, setDetailLine] = useState<BooksVatLine | null>(null);

  const [allowanceStr, setAllowanceStr] = useState(
    String(DEFAULT_PERSONAL_ALLOWANCE),
  );
  const [otherDeductStr, setOtherDeductStr] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [yearBusy, setYearBusy] = useState(false);
  const [yearProfit, setYearProfit] = useState<number | null>(null);
  const [yearTax, setYearTax] = useState<ReturnType<
    typeof computePersonalIncomeTax
  > | null>(null);
  const [yearMonths, setYearMonths] = useState<
    { month: string; income: number; opex: number; profit: number }[]
  >([]);

  const [openDeliverySales, setOpenDeliverySales] = useState(true);
  const [openStorefrontSales, setOpenStorefrontSales] = useState(true);
  const [importMap, setImportMap] = useState<ImportIntoBooksMap | null>(null);

  /** A) แถบส่งหน้าร้าน → ตาราง — ไม่แตะ import/ช่องอื่น / VAT */
  const [sfSendSourceStr, setSfSendSourceStr] = useState("");
  const [sfSendPct, setSfSendPct] = useState(100);
  const [sfPulse, setSfPulse] = useState(false);
  const sfPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGen = useRef(0);

  const locked = draft.status === "filed";

  const refreshImportMap = useCallback(async (m: string) => {
    try {
      const rows = await listVatImportRows(m);
      const preview = previewApplyVatImportRows(m, rows);
      setImportMap(describeImportIntoBooks(preview));
    } catch {
      setImportMap(null);
    }
  }, []);

  const booksCombo = useMemo(() => {
    if (!bookStaff || !bookOwner) return null;
    return {
      cogs: bookStaff.cogs + bookOwner.cogs,
      sga: bookStaff.sga + bookOwner.sga,
      other: bookStaff.other + bookOwner.other,
      asset: bookStaff.asset + bookOwner.asset,
      vatCogs: (bookStaff.vatCogs || 0) + (bookOwner.vatCogs || 0),
      vatSga: (bookStaff.vatSga || 0) + (bookOwner.vatSga || 0),
      vatOther: (bookStaff.vatOther || 0) + (bookOwner.vatOther || 0),
      vatAsset: (bookStaff.vatAsset || 0) + (bookOwner.vatAsset || 0),
    };
  }, [bookStaff, bookOwner]);

  const view = useMemo(
    () => deriveMonthBooksView(draft, booksCombo),
    [draft, booksCombo],
  );

  const period = useMemo(
    () => getVatPeriodBoundary(month, periodStartDay),
    [month, periodStartDay],
  );

  const markDirty = useCallback(() => setDirty(true), []);

  const hydrateFromReturn = useCallback((ret: VatMonthlyReturn) => {
    setDraft(retToMonthBooksDraft(ret));
    setDirty(false);
  }, []);

  /** ผสานคชจ. + ภาษีซื้อจากสองบช. อัตโนมัติ (ไม่ต้องกดดึง) */
  const syncBooksFromLedgers = useCallback(
    async (
      m: string,
      opts?: { writeVat?: boolean; prevIngredient?: number },
    ) => {
      setBooksBusy(true);
      setBooksVatBusy(true);
      try {
        const [staffRows, ownerRows, bundle] = await Promise.all([
          loadStaffMonthBreakdown(),
          loadOwnerMonthBreakdown(),
          loadBothBooksVatByMonth(m),
        ]);
        setBookStaff(pickBookRow(staffRows, m));
        setBookOwner(pickBookRow(ownerRows, m));
        setBooksPulledAt(Date.now());
        setBooksLines(bundle.lines);
        if (bundle.lines.length > 0) setOpenBooksLines(true);
        const writeVat = opts?.writeVat !== false;
        if (!writeVat) return bundle;
        const prev =
          opts?.prevIngredient ??
          (draftRef.current.monthKey === m
            ? draftRef.current.ingredientVat
            : bundle.vatInput);
        const changed = Math.abs(prev - bundle.vatInput) >= 0.009;
        setDraft((d) => {
          if (d.monthKey !== m || d.status === "filed") return d;
          if (!changed) return d;
          return { ...d, ingredientVat: bundle.vatInput };
        });
        if (changed && draftRef.current.status !== "filed") {
          setDirty(true);
        }
        return bundle;
      } finally {
        setBooksBusy(false);
        setBooksVatBusy(false);
      }
    },
    [],
  );

  const loadMonth = useCallback(
    async (m: string) => {
      const gen = ++loadGen.current;
      setLoading(true);
      setError("");
      setMsg("");
      setBookStaff(null);
      setBookOwner(null);
      setBooksPulledAt(0);
      setBooksLines([]);
      setOpenBooksLines(false);
      try {
        const [ret, settings, tax] = await Promise.all([
          loadVatMonthlyReturn(m),
          loadVatMonthlySettings(),
          loadPersonalTaxSettings(),
        ]);
        if (gen !== loadGen.current) return;
        setPeriodStartDay(settings.periodStartDay);
        setAllowanceStr(String(tax.personalAllowance));
        setOtherDeductStr(
          tax.otherDeductions > 0 ? moneyFieldValue(tax.otherDeductions) : "",
        );
        setTaxNote(tax.note || "");
        const draft0 = retToMonthBooksDraft(ret);
        hydrateFromReturn(ret);
        setHydrated(true);
        void refreshImportMap(m);
        // คชจ.บช. + ภาษีซื้อบช. ผสานอัตโนมัติ
        try {
          await syncBooksFromLedgers(m, {
            writeVat: ret.status !== "filed",
            prevIngredient: draft0.ingredientVat,
          });
        } catch {
          /* โชว์งบต่อได้แม้บช.โหลดไม่ครบ */
        }
      } catch (e) {
        if (gen !== loadGen.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setDraft(emptyMonthBooksDraft(m));
        setHydrated(true);
      } finally {
        if (gen === loadGen.current) setLoading(false);
      }
    },
    [hydrateFromReturn, refreshImportMap, syncBooksFromLedgers],
  );

  useEffect(() => {
    void loadMonth(month);
  }, [month, loadMonth]);

  // ซิงก์จากแท็บนำเข้า (ไม่แตะโค้ดนำเข้า)
  useEffect(() => {
    return subscribeVatImportMonthMerged((detail) => {
      if (detail.monthKey !== month) return;
      if (draftRef.current.status === "filed") return;
      const next = retToMonthBooksDraft(detail.saved);
      setDraft(next);
      setDirty(false);
      const income =
        next.transfer.shopee +
        next.transfer.grab +
        next.transfer.lineman +
        next.transfer.storefront;
      setMsg(`ซิงก์จากนำเข้า · รายได้ถึงร้าน ${formatVatMoney(income)}`);
      void refreshImportMap(month);
    });
  }, [month, refreshImportMap]);

  // อัตโนมัติเซฟเบา ๆ
  useEffect(() => {
    if (!hydrated || loading || locked || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const input = draftToSaveInput(draftRef.current, "draft");
          const saved = await saveVatMonthlyReturn(input, actor);
          setDraft((d) => ({ ...d, status: saved.status }));
          setDirty(false);
        } catch {
          /* silent autosave */
        }
      })();
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, dirty, hydrated, loading, locked, actor]);

  function setTransferField(key: MonthChannel | "storefront", raw: string) {
    if (locked) return;
    setDraft((d) => patchTransfer(d, key, parseVatMoneyInput(raw)));
    markDirty();
  }

  // โหลด % ล่าสุด + ยอดต้นทางของเดือน (ไม่เขียนทับตารางจนกว่าจะเลื่อน/แก้ยอด)
  useEffect(() => {
    setSfSendPct(loadSfSendPct());
    const src = loadSfSendSource(month);
    setSfSendSourceStr(src > 0 ? moneyFieldValue(src) : "");
    setSfPulse(false);
  }, [month]);

  const flashSfCell = useCallback(() => {
    setSfPulse(true);
    if (sfPulseTimer.current) clearTimeout(sfPulseTimer.current);
    sfPulseTimer.current = setTimeout(() => setSfPulse(false), 900);
  }, []);

  const applySfSendToTable = useCallback(
    (source: number, pct: number) => {
      if (locked) return;
      if (!(source > 0)) return; // ห้ามเขียน 0 ทับยอดในตารางเมื่อยังไม่มีต้นทาง
      const sent = computeSfSendAmount(source, pct);
      setDraft((d) => {
        const sameIncome =
          Math.abs((d.transfer.storefront || 0) - sent) < 0.009;
        const sameSales =
          Math.abs((d.sales.storefrontTransfer || 0) - sent) < 0.009 &&
          Math.abs((d.sales.storefrontCash || 0)) < 0.009;
        if (sameIncome && sameSales) return d;
        // A รายได้ถึงร้าน + D ยอดขายโอนทั้งก้อน → ภาษีขาย
        return patchSfSendIntoDraft(d, sent);
      });
      markDirty();
      flashSfCell();
    },
    [locked, markDirty, flashSfCell],
  );

  /** ต้นทางแถบส่ง — ช่องกรอก หรือยอดหน้าร้านในตาราง (ถ้ายังไม่กรอก) */
  function resolveSfSendSource(rawStr: string): number {
    const typed = parseVatMoneyInput(rawStr);
    if (typed > 0) return typed;
    const fromTable = Number(draftRef.current.transfer.storefront) || 0;
    return fromTable > 0 ? fromTable : 0;
  }

  function onSfSendSourceChange(raw: string) {
    setSfSendSourceStr(raw);
    if (locked) return;
    const source = parseVatMoneyInput(raw);
    saveSfSendSource(month, source);
    if (source > 0) applySfSendToTable(source, sfSendPct);
  }

  function onSfSendPctChange(next: number) {
    const pct = Math.min(100, Math.max(0, Math.round(next)));
    setSfSendPct(pct);
    saveSfSendPct(pct);
    if (locked) return;
    const source = resolveSfSendSource(sfSendSourceStr);
    if (!(source > 0)) {
      setMsg("ใส่ยอดหน้าร้านต้นทางก่อน แล้วค่อยเลื่อน % ส่งเข้าตาราง");
      return;
    }
    // ถ้ายังไม่กรอกต้นทาง — เติมจากยอดในตารางแล้วค่อยคิด %
    if (!(parseVatMoneyInput(sfSendSourceStr) > 0)) {
      setSfSendSourceStr(moneyFieldValue(source));
      saveSfSendSource(month, source);
    }
    applySfSendToTable(source, pct);
  }

  const sfSendSourceNum = useMemo(
    () => parseVatMoneyInput(sfSendSourceStr),
    [sfSendSourceStr],
  );
  const sfSendPreview = useMemo(
    () => computeSfSendAmount(sfSendSourceNum, sfSendPct),
    [sfSendSourceNum, sfSendPct],
  );
  const sfUnsent = useMemo(
    () => computeSfUnsentAmount(sfSendSourceNum, sfSendPct),
    [sfSendSourceNum, sfSendPct],
  );
  const realProfitAfterVat = useMemo(
    () => computeRealProfitAfterVat(view.profitAfterVat, sfUnsent),
    [view.profitAfterVat, sfUnsent],
  );
  const netProfitMarginPct = useMemo(
    () => computeNetProfitMarginPct(view.profitAfterVat, view.incomeTotal),
    [view.profitAfterVat, view.incomeTotal],
  );

  function setGpField(key: MonthChannel, raw: string) {
    if (locked) return;
    setDraft((d) => patchGpFee(d, key, parseVatMoneyInput(raw)));
    markDirty();
  }

  function setGpVatField(key: MonthChannel, raw: string) {
    if (locked) return;
    setDraft((d) => patchGpVat(d, key, parseVatMoneyInput(raw)));
    markDirty();
  }

  function setSalesField(key: keyof MonthBooksDraft["sales"], raw: string) {
    if (locked) return;
    setDraft((d) => patchSales(d, key, parseVatMoneyInput(raw)));
    markDirty();
  }

  const toggleLineClaim = async (line: BooksVatLine, nextClaim: boolean) => {
    if (locked || line.vatClaim === nextClaim) return;
    const nextLines = booksLines.map((l) =>
      l.id === line.id && l.book === line.book
        ? { ...l, vatClaim: nextClaim }
        : l,
    );
    const nextVat = sumClaimedBooksVat(nextLines);
    const vat = Number(line.vatInput) || 0;
    // หักภาษีซื้อ → คชจ.ลด · ยกเลิก → คชจ.คืนเป็นบิลเต็ม
    const costDelta = nextClaim ? -vat : vat;
    setBooksLines(nextLines);
    setDraft((d) => ({ ...d, ingredientVat: nextVat }));
    if (line.book === "ledger") {
      setBookStaff((r) => applyClaimCostDelta(r, costDelta));
    } else {
      setBookOwner((r) => applyClaimCostDelta(r, costDelta));
    }
    markDirty();
    setMsg(
      nextClaim
        ? `หักภาษีซื้อ ${fmt(vat)} · ภาษีซื้อสองบช.เพิ่ม · คชจ.ลด`
        : `ยกเลิกหัก · ภาษีซื้อสองบช.ลด · คชจ.ใช้บิลเต็ม (+${fmt(vat)})`,
    );
    try {
      if (line.book === "ledger") {
        await updateLedgerEntry(line.id, { vatClaim: nextClaim });
      } else {
        await updateOwnerBookEntry(line.id, { vatClaim: nextClaim });
      }
      await syncBooksFromLedgers(month, {
        writeVat: true,
        prevIngredient: nextVat,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void syncBooksFromLedgers(month, { writeVat: true });
    }
  };

  const toggleClaimAll = async (nextClaim: boolean) => {
    if (locked || booksLines.length === 0) return;
    const changing = booksLines.filter((line) => line.vatClaim !== nextClaim);
    if (changing.length === 0) return;
    const nextLines = booksLines.map((l) => ({ ...l, vatClaim: nextClaim }));
    const nextVat = sumClaimedBooksVat(nextLines);
    let staffDelta = 0;
    let ownerDelta = 0;
    for (const line of changing) {
      const vat = Number(line.vatInput) || 0;
      const d = nextClaim ? -vat : vat;
      if (line.book === "ledger") staffDelta += d;
      else ownerDelta += d;
    }
    setBooksLines(nextLines);
    setDraft((d) => ({ ...d, ingredientVat: nextVat }));
    if (staffDelta) setBookStaff((r) => applyClaimCostDelta(r, staffDelta));
    if (ownerDelta) setBookOwner((r) => applyClaimCostDelta(r, ownerDelta));
    markDirty();
    setMsg(
      nextClaim
        ? `ติ๊กหักภาษีซื้อทั้งหมด · ภาษีซื้อสองบช. ${fmt(nextVat)}`
        : "ยกเลิกหักทั้งหมด · คชจ.กลับเป็นบิลเต็ม · ภาษีซื้อสองบช. = 0",
    );
    setBooksVatBusy(true);
    try {
      await Promise.all(
        changing.map((line) =>
          line.book === "ledger"
            ? updateLedgerEntry(line.id, { vatClaim: nextClaim })
            : updateOwnerBookEntry(line.id, { vatClaim: nextClaim }),
        ),
      );
      await syncBooksFromLedgers(month, {
        writeVat: true,
        prevIngredient: nextVat,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void syncBooksFromLedgers(month, { writeVat: true });
    } finally {
      setBooksVatBusy(false);
    }
  };

  const saveDraft = async (as: "draft" | "saved") => {
    setBusy(true);
    setError("");
    try {
      const saved = await saveVatMonthlyReturn(
        draftToSaveInput(draft, as),
        actor,
      );
      hydrateFromReturn(saved);
      setMsg(as === "draft" ? "บันทึกร่างแล้ว" : "บันทึกแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const trialToPnl = async () => {
    setBusy(true);
    setError("");
    try {
      await saveVatMonthlyReturn(draftToSaveInput(draft, "saved"), actor);
      await saveMonthlyIncome(month, view.incomeTotal, actor);
      setMsg(
        `รายได้ทดลอง → P&L · ${formatVatMoney(view.incomeTotal)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fileMonth = async () => {
    setBusy(true);
    setError("");
    try {
      await saveVatMonthlyReturn(draftToSaveInput(draft, "saved"), actor);
      const filed = await fileVatMonthlyReturn(month, actor, {
        forceIncome: view.incomeTotal,
      });
      hydrateFromReturn(filed);
      setMsg(
        `ปิดงบแล้ว · รายได้ ${formatVatMoney(filed.pnlIncome)} เข้า P&L`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlockMonth = async () => {
    setBusy(true);
    setError("");
    try {
      const unlocked = await unlockVatMonthlyReturn(month, actor);
      hydrateFromReturn(unlocked);
      setMsg("ปลดล็อกแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTaxSettings = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await savePersonalTaxSettings(
        {
          personalAllowance:
            parseVatMoneyInput(allowanceStr) || DEFAULT_PERSONAL_ALLOWANCE,
          otherDeductions: parseVatMoneyInput(otherDeductStr),
          note: taxNote,
        },
        actor,
      );
      setAllowanceStr(String(saved.personalAllowance));
      setOtherDeductStr(
        saved.otherDeductions > 0
          ? moneyFieldValue(saved.otherDeductions)
          : "",
      );
      setTaxNote(saved.note);
      if (yearProfit != null) {
        setYearTax(
          computePersonalIncomeTax(yearProfit, {
            personalAllowance: saved.personalAllowance,
            otherDeductions: saved.otherDeductions,
          }),
        );
      }
      setMsg("บันทึกค่าลดหย่อนแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pullYearSummary = async () => {
    setYearBusy(true);
    setError("");
    try {
      const report = await loadPnlReport();
      const year = month.slice(0, 4);
      const months = report.combined
        .filter((r) => r.month.startsWith(year))
        .map((r) => {
          const income = Number(report.incomeByMonth[r.month]) || 0;
          const opex = r.cogs + r.sga + r.other;
          return {
            month: r.month,
            income,
            opex,
            profit: income - opex,
          };
        })
        .filter((m) => m.income > 0 || m.opex > 0);
      const profit = months.reduce((s, m) => s + m.profit, 0);
      const allowance =
        parseVatMoneyInput(allowanceStr) || DEFAULT_PERSONAL_ALLOWANCE;
      const other = parseVatMoneyInput(otherDeductStr);
      setYearMonths(months);
      setYearProfit(profit);
      setYearTax(
        computePersonalIncomeTax(profit, {
          personalAllowance: allowance,
          otherDeductions: other,
        }),
      );
      setMsg(
        `ดึงสรุปปี ${Number(year) + 543} · กำไร ${formatVatMoney(profit)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setYearBusy(false);
    }
  };

  const exportYearTax = () => {
    if (!yearTax || yearProfit == null) return;
    try {
      exportPersonalTaxYearXlsx({
        yearCe: Number(month.slice(0, 4)),
        months: yearMonths,
        personalAllowance: yearTax.personalAllowance,
        otherDeductions: yearTax.otherDeductions,
        taxable: yearTax.taxable,
        tax: yearTax.tax,
        slices: yearTax.slices,
        note: taxNote,
      });
      setMsg("ส่งออกไฟล์ ภ.ง.ด. แล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const statusLabel =
    draft.status === "filed"
      ? "ปิดงบแล้ว · ล็อก"
      : draft.status === "saved"
        ? "บันทึกแล้ว"
        : "ร่าง";

  const incomeHint = incomeBreakdownLabel(draft);
  const staffOp = bookOpEx(bookStaff);
  const ownerOp = bookOpEx(bookOwner);

  return (
    <div className="vat-month-books">
      <div className="vat-top-bar">
        <label className="vat-month-pick">
          <span className="muted">เดือน</span>
          <select
            value={month}
            disabled={busy}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="เลือกเดือน"
          >
            {monthOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`vat-status-badge${locked ? " is-filed" : ""}`}
          title={statusLabel}
        >
          {statusLabel}
          {dirty ? (
            <span className="vat-dirty-dot" title="มีการแก้ที่ยังไม่บันทึก">
              ·
            </span>
          ) : null}
        </span>
      </div>

      <p className="muted vat-sales-hint vat-hint-one-line">
        รอบตัดยอด {period.labelInclusive}
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {/* สรุปยอดจากนำเข้าที่ผสานเข้างบอัตโนมัติแล้ว (เนื้อเดียว · ไม่มีปุ่มดึง) */}
      <section className="vat-table-block vat-import-into-books">
        <h2 className="vat-table-title">จากตารางนำเข้า → งบ (ผสานอัตโนมัติ)</h2>
        {importMap && importMap.rowCount > 0 ? (
          <>
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                <thead>
                  <tr>
                    <th className="col-seg">ช่อง</th>
                    <th
                      className="col-num"
                      title="ยอดขายรวม VAT → กล่อง D คิดภาษีขาย"
                    >
                      ขาย→D
                    </th>
                    <th
                      className="col-num"
                      title="ค่า GP ที่หักจากโอนแล้ว — โชว์ใน B / ไม่หักซ้ำกำไร"
                    >
                      คชจ.(อ้าง)
                    </th>
                    <th
                      className="col-num"
                      title="เงินเข้าบัญชีหลังหัก GP = รายได้ถึงร้าน → กล่อง A"
                    >
                      โอน→A
                    </th>
                    <th
                      className="col-num"
                      title="VAT บนบิลค่า GP — ไม่ใช่เงินหักเพิ่ม → กล่อง D ภาษีซื้อ"
                    >
                      GP≠→D
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MONTH_CHANNELS.map((k) => {
                    const c = importMap.byChannel[k];
                    return (
                      <tr key={k}>
                        <td className="col-seg">{MONTH_CHANNEL_SHORT[k]}</td>
                        <td className="col-num">{fmt(c.sales)}</td>
                        <td className="col-num">{fmt(c.fee)}</td>
                        <td className="col-num">{fmt(c.transfer)}</td>
                        <td className="col-num">{fmt(c.gpVat)}</td>
                      </tr>
                    );
                  })}
                  <tr className="vat-sales-totals-row">
                    <td className="col-seg">รวม ({importMap.rowCount} แถว)</td>
                    <td className="col-num col-net">
                      {fmt(importMap.salesTotal)}
                    </td>
                    <td className="col-num col-net">
                      {fmt(importMap.feeTotal)}
                    </td>
                    <td className="col-num col-net">
                      {fmt(importMap.transferTotal)}
                    </td>
                    <td className="col-num col-net">
                      {fmt(importMap.gpVatTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted vat-sales-hint vat-hint-one-line">
              แก้ที่แท็บนำเข้าแล้วเข้างบทันที · โอน = รายได้ · GP≠ = ภาษีซื้อ
            </p>
          </>
        ) : (
          <p className="muted vat-sales-hint vat-hint-one-line">
            ยังไม่มีแถวในแท็บนำเข้าเดือนนี้ — กรอกที่แท็บนำเข้าแล้วผสานเข้างบอัตโนมัติ
          </p>
        )}
      </section>

      {loading && !hydrated ? (
        <p className="muted">กำลังโหลด…</p>
      ) : (
        <>
          {/* A) รายได้ถึงร้าน */}
          <section className="vat-table-block vat-income-bridge">
            <h2 className="vat-table-title">
              A) รายได้ถึงร้าน — {formatThaiMonthKey(month)}
            </h2>
            <div
              className="vat-sf-send"
              title="ใส่ยอดหน้าร้านต้นทาง แล้วเลื่อน % — ยอดส่งเข้าช่อง「หน้าร้าน」ในตารางรายได้เท่านั้น · ไม่แตะภาษีขาย/ภาษีซื้อ"
            >
              <span className="vat-sf-send-label">ส่งหน้าร้าน</span>
              <input
                className="vat-sales-input vat-sf-send-input"
                inputMode="decimal"
                disabled={locked}
                value={sfSendSourceStr}
                placeholder="ยอดต้นทาง"
                aria-label="ยอดหน้าร้านต้นทาง"
                onChange={(e) => onSfSendSourceChange(e.target.value)}
                onBlur={() => {
                  const next = normalizeMoneyFieldText(sfSendSourceStr);
                  if (next !== sfSendSourceStr) setSfSendSourceStr(next);
                }}
              />
              <input
                type="range"
                className="vat-sf-send-range"
                min={0}
                max={100}
                step={1}
                disabled={locked}
                value={sfSendPct}
                aria-label="เปอร์เซ็นต์ส่งเข้ารายได้ถึงร้าน"
                onChange={(e) => onSfSendPctChange(Number(e.target.value))}
              />
              <span className="vat-sf-send-pct">{sfSendPct}%</span>
              <span
                className={`vat-sf-send-out${sfSendSourceNum > 0 ? " is-live" : ""}`}
                title="ยอดที่ส่งเข้าช่องหน้าร้านในตาราง A"
              >
                → โอน {fmt(sfSendPreview)}
              </span>
              <span
                className="vat-sf-send-unsent"
                title="ส่วนหน้าร้านที่ไม่ถูกส่งเข้าตารางรายได้"
              >
                ค้าง {fmt(sfUnsent)}
              </span>
            </div>
            <p className="muted vat-sales-hint vat-sf-send-hint">
              ส่งเข้า A「ยอดโอนหน้าร้าน」+ D「ยอดขายโอน」ทั้งก้อน → คิดภาษีขายอัตโนมัติ ·{" "}
              ไม่แตะภาษีซื้อ
              {sfSendSourceNum > 0
                ? ""
                : " · ใส่ยอดต้นทางก่อน แล้วเลื่อน %"}
            </p>
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                <thead>
                  <tr>
                    <th className="col-seg">รายการ</th>
                    <th
                      className="col-num"
                      title="เงินถึงร้าน — ซิงก์จากแท็บนำเข้า หรือแก้ตรงนี้"
                    >
                      ยอดโอน / ถึงร้าน
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="vat-row-parent">
                    <td
                      className="col-seg"
                      title="ผลรวมยอดโอน SF+GB+LM (ไม่ใช่ยอดขาย)"
                    >
                      เดลิเวอรี่ (รวม)
                    </td>
                    <td className="col-num col-net">
                      {fmt(view.deliveryTransfer)}
                    </td>
                  </tr>
                  {MONTH_CHANNELS.map((k) => (
                    <tr key={k} className="vat-row-child">
                      <td
                        className="col-seg col-child"
                        title={`ยอดโอน ${MONTH_CHANNEL_LABEL[k]} จากนำเข้า`}
                      >
                        {MONTH_CHANNEL_LABEL[k]}
                      </td>
                      <td className="col-num col-input">
                        <MoneyCell
                          value={moneyFieldValue(draft.transfer[k])}
                          locked={locked}
                          ariaLabel={`ยอดโอน ${MONTH_CHANNEL_SHORT[k]}`}
                          onChange={(v) => setTransferField(k, v)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="vat-row-parent">
                    <td
                      className="col-seg"
                      title="หน้าร้านไม่มีหัก GP — ยอดถึงร้าน = เงินรับจริง"
                    >
                      หน้าร้าน
                    </td>
                    <td className="col-num col-input">
                      <MoneyCell
                        value={moneyFieldValue(draft.transfer.storefront)}
                        locked={locked}
                        ariaLabel="ยอดหน้าร้าน"
                        pulse={sfPulse}
                        onChange={(v) => setTransferField("storefront", v)}
                      />
                    </td>
                  </tr>
                  <tr className="vat-sales-totals-row">
                    <td
                      className="col-seg"
                      title={`รายได้สุทธิ = ${incomeHint}`}
                    >
                      = รายได้สุทธิ
                    </td>
                    <td className="col-num col-net">
                      {fmt(view.incomeTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className="muted vat-sales-hint vat-hint-one-line"
              title="ที่มาของรายได้สุทธิ"
            >
              รายได้ = ยอดโอนหลังหัก GP แล้ว · {incomeHint} ={" "}
              {fmt(view.incomeTotal)} · ไม่ใช่ยอดขาย · ไม่ต้องบวกคชจ.กลับ
            </p>
          </section>

          {/* B) คชจ. */}
          <section className="vat-table-block">
            <h2 className="vat-table-title">
              B) คชจ. — {formatThaiMonthKey(month)}
            </h2>
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                <thead>
                  <tr>
                    <th className="col-seg">รายการ</th>
                    <th className="col-num">ยอด</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="vat-row-parent">
                    <td
                      className="col-seg"
                      title="แพลตฟอร์มหักจากยอดโอนแล้ว — ไม่หักซ้ำตอนคิดกำไร"
                    >
                      GP แพลตฯ (หักจากโอนแล้ว · ไม่หักซ้ำ)
                    </td>
                    <td className="col-num col-net">{fmt(view.gpCostTotal)}</td>
                  </tr>
                  {MONTH_CHANNELS.map((k) => (
                    <tr key={k} className="vat-row-child">
                      <td className="col-seg col-child">
                        {MONTH_CHANNEL_LABEL[k]}
                      </td>
                      <td className="col-num col-input">
                        <MoneyCell
                          value={moneyFieldValue(draft.gpFee[k])}
                          locked={locked}
                          ariaLabel={`คชจ. GP ${MONTH_CHANNEL_SHORT[k]}`}
                          onChange={(v) => setGpField(k, v)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="vat-row-parent">
                    <td
                      className="col-seg"
                      title="ผสานจากบช.พนักงาน + เจ้าของอัตโนมัติ"
                    >
                      คชจ. สองบช. (หักกำไร)
                      {booksBusy ? (
                        <span className="muted"> …</span>
                      ) : null}
                    </td>
                    <td className="col-num col-net">
                      {view.booksOpex == null ? "—" : fmt(view.booksOpex)}
                    </td>
                  </tr>
                  {bookStaff && bookOwner ? (
                    <>
                      <tr className="vat-row-child">
                        <td className="col-seg col-child">
                          พนง. (COGS+SGA+อื่น)
                        </td>
                        <td className="col-num">
                          {staffOp == null ? "—" : fmt(staffOp)}
                        </td>
                      </tr>
                      <tr className="vat-row-child">
                        <td className="col-seg col-child">
                          เจ้าของ (COGS+SGA+อื่น)
                        </td>
                        <td className="col-num">
                          {ownerOp == null ? "—" : fmt(ownerOp)}
                        </td>
                      </tr>
                      <tr className="vat-row-child">
                        <td
                          className="col-seg col-child"
                          title="สินทรัพย์โชว์อย่างเดียว — ไม่หักกำไร"
                        >
                          สินทรัพย์ (ไม่หัก)
                        </td>
                        <td className="col-num">{fmt(view.booksAsset)}</td>
                      </tr>
                      <tr className="vat-row-child vat-cost-layer-head">
                        <td className="col-seg col-child" colSpan={2}>
                          ชั้นคิดต้นทุนบช. (นักบัญชี / สรรพากร)
                        </td>
                      </tr>
                      <tr className="vat-row-child vat-cost-layer">
                        <td
                          className="col-seg col-child"
                          title="รายการที่ติ๊กหักภาษีซื้อ — VAT ถูกตัดออกจากต้นทุน ไปหักภาษีขายใน D"
                        >
                          1) ติ๊กหักภาษีซื้อ → ต้นทุน = บิล − VAT
                        </td>
                        <td className="col-num">
                          {fmt(booksCombo?.cogs ?? 0)}
                          <span className="muted vat-cost-layer-sub">
                            {" "}
                            COGS
                          </span>
                        </td>
                      </tr>
                      <tr className="vat-row-child vat-cost-layer">
                        <td
                          className="col-seg col-child"
                          title="ภาษีซื้อจากรายการที่เคลม — ไม่ปนในต้นทุน · ไปหักภาษีขายใน D"
                        >
                          · VAT ที่ตัดออกจากต้นทุน → D
                        </td>
                        <td className="col-num">
                          {fmt(booksCombo?.vatCogs ?? 0)}
                        </td>
                      </tr>
                      <tr className="vat-row-child vat-cost-layer">
                        <td
                          className="col-seg col-child"
                          title="รายการไม่ติ๊ก — ใช้ยอดบิลรวม VAT ทั้งก้อนเป็นต้นทุน · ไม่นับภาษีซื้อใน D"
                        >
                          2) ไม่ติ๊ก → ต้นทุน = บิลรวม VAT ทั้งก้อน
                        </td>
                        <td className="col-num muted">รวมในคชจ.ด้านบน</td>
                      </tr>
                    </>
                  ) : null}
                  <tr className="vat-sales-totals-row">
                    <td
                      className="col-seg"
                      title="หักจากกำไรได้แค่คชจ.บช. · GP อยู่ในยอดโอนแล้ว"
                    >
                      = คชจ. ที่หักกำไร
                    </td>
                    <td className="col-num col-net">
                      {view.costTotal == null ? "—" : fmt(view.costTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted vat-sales-hint vat-hint-one-line">
              คชจ.บช. = ต้นทุนหลังตัด VAT ที่ติ๊กหัก · VAT ที่ตัดไปหักภาษีขายใน D ·
              ไม่ติ๊ก = คชจ.บิลเต็ม
              {booksPulledAt
                ? ` · อัปเดต ${formatDateShort(booksPulledAt)}`
                : ""}
            </p>
          </section>

          {/* C) กำไร + ภ.ง.ด. */}
          <section className="vat-table-block vat-personal-pnl">
            <h2 className="vat-table-title">
              C) กำไรเดือน + ภ.ง.ด. — {formatThaiMonthKey(month)}
            </h2>
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                <thead>
                  <tr>
                    <th className="col-seg">รายการ</th>
                    <th className="col-num">ยอด</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      className="col-seg"
                      title="ยอดโอน SF/GB/LM + หน้าร้าน — หลังหัก GP แพลตฯ แล้ว"
                    >
                      รายได้ถึงร้าน (ยอดโอน)
                    </td>
                    <td className="col-num">{fmt(view.incomeTotal)}</td>
                  </tr>
                  <tr>
                    <td
                      className="col-seg"
                      title="หักแค่คชจ.สองบช. — ไม่หัก GP ซ้ำ"
                    >
                      − คชจ. บช. (ไม่รวม GP)
                    </td>
                    <td className="col-num">
                      {view.booksOpex == null ? "—" : fmt(view.booksOpex)}
                    </td>
                  </tr>
                  <tr className="vat-row-child">
                    <td
                      className="col-seg col-child"
                      title="อ้างอิงเท่านั้น — หักจากยอดโอนแล้ว"
                    >
                      GP แพลตฯ (หักจากโอนแล้ว)
                    </td>
                    <td className="col-num">{fmt(view.gpCostTotal)}</td>
                  </tr>
                  <tr className="vat-sales-totals-row">
                    <td
                      className="col-seg"
                      title="รายได้ถึงร้าน − คชจ.บช. · ยังไม่หัก VAT"
                    >
                      = กำไรประมาณการเดือน
                    </td>
                    <td className="col-num col-net">
                      {view.monthProfit == null ? "—" : fmt(view.monthProfit)}
                    </td>
                  </tr>
                  <tr>
                    <td
                      className="col-seg"
                      title="จากกล่อง D · ยอดบวก = ต้องนำส่ง · ติดลบ = ได้คืน"
                    >
                      − VAT สุทธิ
                    </td>
                    <td className="col-num">{fmt(view.netVat)}</td>
                  </tr>
                  <tr className="vat-sales-totals-row">
                    <td
                      className="col-seg"
                      title="กำไรประมาณการ − VAT สุทธิ = เงินเหลือโดยประมาณหลังนำส่ง VAT"
                    >
                      = กำไรสุทธิ (หลังหัก VAT)
                    </td>
                    <td className="col-num col-net">
                      {view.profitAfterVat == null
                        ? "—"
                        : fmt(view.profitAfterVat)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className="muted vat-sales-hint vat-hint-one-line vat-c-real-note"
              title="โน้ตดูเอง — ไม่แก้ VAT / ภ.ง.ด. / P&L"
            >
              อัตรากำไรสุทธิ{" "}
              {netProfitMarginPct == null ? "—" : `${fmt(netProfitMarginPct)}%`}
              <span className="vat-c-real-sep">·</span>
              กำไรจริง{" "}
              {realProfitAfterVat == null ? "—" : fmt(realProfitAfterVat)}
              <span className="muted">
                {" "}
                (= สุทธิหลัง VAT
                {view.profitAfterVat == null
                  ? ""
                  : ` ${fmt(view.profitAfterVat)}`}{" "}
                + ค้างหน้าร้าน {fmt(sfUnsent)})
              </span>
            </p>

            <h2 className="vat-table-title" style={{ marginTop: "0.55rem" }}>
              ค่าลดหย่อน + ภาษีเงินได้ (ภ.ง.ด.) · ปี{" "}
              {Number(month.slice(0, 4)) + 543}
            </h2>
            <div className="sheet-wrap vat-month-slim-wrap">
              <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                <thead>
                  <tr>
                    <th className="col-seg">รายการ</th>
                    <th className="col-num">ค่า</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="col-seg">ค่าลดหย่อนผู้มีเงินได้</td>
                    <td className="col-num col-input">
                      <MoneyCell
                        value={allowanceStr}
                        locked={locked}
                        ariaLabel="ค่าลดหย่อน"
                        onChange={setAllowanceStr}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="col-seg">ลดหย่อนอื่น</td>
                    <td className="col-num col-input">
                      <MoneyCell
                        value={otherDeductStr}
                        locked={locked}
                        ariaLabel="ลดหย่อนอื่น"
                        onChange={setOtherDeductStr}
                      />
                    </td>
                  </tr>
                  {yearProfit != null && yearTax ? (
                    <>
                      <tr>
                        <td className="col-seg">กำไรปี (จาก P&L)</td>
                        <td className="col-num">{fmt(yearProfit)}</td>
                      </tr>
                      <tr>
                        <td className="col-seg">เงินได้สุทธิภาษี</td>
                        <td className="col-num">{fmt(yearTax.taxable)}</td>
                      </tr>
                      <tr className="vat-sales-totals-row">
                        <td className="col-seg">ภาษีประมาณการ</td>
                        <td className="col-num col-net">{fmt(yearTax.tax)}</td>
                      </tr>
                    </>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="vat-month-actions vat-month-actions--mini">
              <button
                type="button"
                className="vat-mini-btn"
                disabled={busy || locked}
                onClick={() => void saveTaxSettings()}
              >
                บันทึกค่าลดหย่อน
              </button>
              <button
                type="button"
                className="vat-mini-btn"
                disabled={yearBusy}
                onClick={() => void pullYearSummary()}
              >
                {yearBusy ? "…" : "ดึงสรุปปี"}
              </button>
              <button
                type="button"
                className="vat-mini-btn"
                disabled={!yearTax}
                onClick={exportYearTax}
              >
                ส่งออก ภ.ง.ด.
              </button>
            </div>
            <label className="vat-note-slim">
              <span className="muted">โน้ตภาษี</span>
              <input
                value={taxNote}
                disabled={locked}
                onChange={(e) => setTaxNote(e.target.value)}
              />
            </label>
          </section>

          {/* D) VAT */}
          <div className="vat-gp-input-bundle">
            <h2 className="vat-table-title">
              D) VAT — ภาษีขาย − ภาษีซื้อ — {formatThaiMonthKey(month)}
            </h2>

            <section className="vat-table-block">
              <h3 className="vat-table-subtitle">ยอดขาย → ภาษีขาย</h3>
              <div className="sheet-wrap vat-month-slim-wrap">
                <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                  <thead>
                    <tr>
                      <th className="col-seg">รายการ</th>
                      <th className="col-num">ยอดขาย</th>
                      <th className="col-num">ภาษีขาย</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="vat-row-parent">
                      <td className="col-seg">
                        <span className="vat-seg-cell">
                          <ExpandBtn
                            open={openDeliverySales}
                            onToggle={() =>
                              setOpenDeliverySales((v) => !v)
                            }
                            label="เดลิเวอรี่"
                          />
                          <span className="vat-seg-label">เดลิเวอรี่</span>
                        </span>
                      </td>
                      <td className="col-num col-net">
                        {fmt(view.delivery.reportedGross)}
                      </td>
                      <td className="col-num col-net">
                        {fmt(view.delivery.outputVat)}
                      </td>
                    </tr>
                    {openDeliverySales
                      ? MONTH_CHANNELS.map((k) => (
                          <tr key={k} className="vat-row-child">
                            <td className="col-seg col-child">
                              {MONTH_CHANNEL_LABEL[k]}
                            </td>
                            <td className="col-num col-input">
                              <MoneyCell
                                value={moneyFieldValue(draft.sales[k])}
                                locked={locked}
                                ariaLabel={`ยอดขาย ${MONTH_CHANNEL_SHORT[k]}`}
                                onChange={(v) => setSalesField(k, v)}
                              />
                            </td>
                            <td className="col-num">—</td>
                          </tr>
                        ))
                      : null}
                    <tr className="vat-row-parent">
                      <td className="col-seg">
                        <span className="vat-seg-cell">
                          <ExpandBtn
                            open={openStorefrontSales}
                            onToggle={() =>
                              setOpenStorefrontSales((v) => !v)
                            }
                            label="หน้าร้าน"
                          />
                          <span className="vat-seg-label">หน้าร้าน</span>
                        </span>
                      </td>
                      <td className="col-num col-net">
                        {fmt(view.storefront.reportedGross)}
                      </td>
                      <td className="col-num col-net">
                        {fmt(view.storefront.outputVat)}
                      </td>
                    </tr>
                    {openStorefrontSales ? (
                      <>
                        <tr className="vat-row-child">
                          <td
                            className="col-seg col-child"
                            title="เติมอัตโนมัติจากแถบส่งหน้าร้านใน A (ยอดหลัง %) — คิดภาษีขาย"
                          >
                            โอน ← จากแถบ A
                          </td>
                          <td className="col-num col-input">
                            <MoneyCell
                              value={moneyFieldValue(
                                draft.sales.storefrontTransfer,
                              )}
                              locked={locked}
                              ariaLabel="ยอดขายหน้าร้านโอน"
                              onChange={(v) =>
                                setSalesField("storefrontTransfer", v)
                              }
                            />
                          </td>
                          <td className="col-num">—</td>
                        </tr>
                        <tr className="vat-row-child">
                          <td className="col-seg col-child">สด</td>
                          <td className="col-num col-input">
                            <MoneyCell
                              value={moneyFieldValue(
                                draft.sales.storefrontCash,
                              )}
                              locked={locked}
                              ariaLabel="ยอดขายหน้าร้านสด"
                              onChange={(v) =>
                                setSalesField("storefrontCash", v)
                              }
                            />
                          </td>
                          <td className="col-num">—</td>
                        </tr>
                      </>
                    ) : null}
                    <tr className="vat-sales-totals-row">
                      <td className="col-seg">รวมภาษีขาย</td>
                      <td className="col-num">{fmt(view.salesTotal)}</td>
                      <td className="col-num col-net">{fmt(view.outputVat)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="vat-table-block">
              <h3 className="vat-table-subtitle">ภาษีซื้อ — GP + สองบช.</h3>
              <p className="muted vat-sales-hint vat-books-claim-hint">
                ชั้นภาษีซื้อ: ติ๊กหัก = VAT ไปหักภาษีขาย + ต้นทุนใน B = บิล−VAT ·
                ไม่ติ๊ก = ไม่นับภาษีซื้อ · ต้นทุนใน B = บิลรวม VAT ·{" "}
                <strong>ภาษีขายด้านบนไม่เปลี่ยนจากติ๊กนี้</strong>
              </p>
              <div className="sheet-wrap vat-month-slim-wrap">
                <table className="sheet-table vat-sales-table vat-sales-table--slim vat-month-slim vat-close-table">
                  <thead>
                    <tr>
                      <th className="col-seg">รายการ</th>
                      <th className="col-num">ภาษีซื้อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="vat-row-parent">
                      <td
                        className="col-seg"
                        title="จากนำเข้าคอลัมน์ GP≠ หรือประมาณคชจ.×7/107"
                      >
                        ภาษีซื้อ GP (รวม)
                      </td>
                      <td className="col-num col-net">{fmt(view.inputGpVat)}</td>
                    </tr>
                    {MONTH_CHANNELS.map((k) => (
                      <tr key={`gpvat-${k}`} className="vat-row-child">
                        <td className="col-seg col-child">
                          GP≠ {MONTH_CHANNEL_LABEL[k]}
                        </td>
                        <td className="col-num col-input">
                          <MoneyCell
                            value={moneyFieldValue(draft.gpVatOverride[k])}
                            locked={locked}
                            ariaLabel={`ภาษีซื้อ GP ${MONTH_CHANNEL_SHORT[k]}`}
                            onChange={(v) => setGpVatField(k, v)}
                          />
                        </td>
                      </tr>
                    ))}
                    <tr className="vat-row-parent">
                      <td className="col-seg">
                        <span className="vat-seg-cell">
                          <ExpandBtn
                            open={openBooksLines}
                            onToggle={() => setOpenBooksLines((v) => !v)}
                            label="รายการจากสองบช"
                          />
                          <span
                            className="vat-seg-label"
                            title="ยอดจากรายการที่ติ๊ก「หักภาษีซื้อ」ในสองบช. — หักจากภาษีขายในแถบสุทธิ"
                          >
                            ภาษีซื้อสองบช.
                            {booksVatBusy ? " …" : ""}
                          </span>
                        </span>
                      </td>
                      <td className="col-num col-input">
                        <MoneyCell
                          value={moneyFieldValue(draft.ingredientVat)}
                          locked={locked}
                          ariaLabel="ภาษีซื้อสองบช."
                          onChange={(v) => {
                            setDraft((d) => ({
                              ...d,
                              ingredientVat: parseVatMoneyInput(v),
                            }));
                            markDirty();
                          }}
                        />
                      </td>
                    </tr>
                    <tr className="vat-row-child">
                      <td
                        className="col-seg col-child"
                        title="ค่าหลัง claim / ปัด — คือยอดที่หักจากภาษีขายจริง"
                      >
                        → หักจากภาษีขาย
                      </td>
                      <td className="col-num col-net">
                        {fmt(view.inputBooksVat)}
                      </td>
                    </tr>
                    {openBooksLines && booksLines.length > 0 ? (
                      <>
                        <tr className="vat-row-child vat-books-breakdown">
                          <td className="col-seg col-child" colSpan={2}>
                            <label className="vat-claim-all">
                              <input
                                type="checkbox"
                                className="vat-claim-check"
                                disabled={locked || booksVatBusy}
                                checked={booksLines.every((l) => l.vatClaim)}
                                onChange={(e) =>
                                  void toggleClaimAll(e.target.checked)
                                }
                                aria-label="ติ๊กหักภาษีซื้อทั้งหมด"
                                title="ติ๊กหักภาษีซื้อทั้งหมด"
                              />{" "}
                              ติ๊กหักภาษีซื้อทั้งหมด ({booksLines.length})
                            </label>
                          </td>
                        </tr>
                        {booksLines.map((line) => (
                          <tr
                            key={`${line.book}-${line.id}`}
                            className={`vat-row-child vat-books-line-row${line.vatClaim ? " is-claimed" : ""}`}
                          >
                            <td className="col-seg col-child">
                              <label className="vat-claim-line">
                                <input
                                  type="checkbox"
                                  className="vat-claim-check"
                                  disabled={locked}
                                  checked={line.vatClaim}
                                  onChange={(e) =>
                                    void toggleLineClaim(
                                      line,
                                      e.target.checked,
                                    )
                                  }
                                  title={
                                    line.vatClaim
                                      ? "กำลังหักภาษีซื้อ — แตะเพื่อยกเลิก (คชจ.กลับเป็นบิลเต็ม)"
                                      : "ยังไม่หัก — แตะเพื่อหักภาษีซื้อ (คชจ.ลดตาม VAT)"
                                  }
                                />{" "}
                                <button
                                  type="button"
                                  className="vat-books-line-btn"
                                  title={`${line.description} — แตะเพื่อดูรายละเอียด`}
                                  onClick={() => setDetailLine(line)}
                                >
                                  {bookLabel(line.book as BooksVatBook)} ·{" "}
                                  {formatDateShort(line.date)} ·{" "}
                                  {line.description}
                                </button>
                                <span className="vat-claim-line-mode">
                                  {line.vatClaim
                                    ? `หักภาษีซื้อ · ต้นทุน ${fmt(Math.max(0, line.amountOut - line.vatInput))}`
                                    : `ซื้อไปเหอะ · ต้นทุนบิลเต็ม ${fmt(line.amountOut)}`}
                                </span>
                              </label>
                            </td>
                            <td className="col-num">{fmt(line.vatInput)}</td>
                          </tr>
                        ))}
                      </>
                    ) : null}
                    <tr className="vat-sales-totals-row">
                      <td
                        className="col-seg"
                        title={
                          view.includeInputVat
                            ? "ภาษีซื้อ GP + สองบช. ที่นำมาหักจากภาษีขาย"
                            : "คำนวณภาษีซื้อไว้โชว์ — ยังไม่หักจากภาษีขาย (ปิดติ๊กด้านล่าง)"
                        }
                      >
                        {view.includeInputVat
                          ? "รวมภาษีซื้อ (หักจากภาษีขาย)"
                          : "รวมภาษีซื้อ (ยังไม่หัก)"}
                      </td>
                      <td className="col-num col-net">{fmt(view.inputVat)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <label
              className="vat-include-input-toggle"
              title="ช่วงจด VAT ขอคืนไม่ได้ — ปิดติ๊กเพื่อเตรียมจ่ายภาษีขายเต็ม · ภาษีขายคำนวณเสมอ"
            >
              <input
                type="checkbox"
                className="vat-claim-check"
                disabled={locked}
                checked={draft.includeInputVat}
                onChange={(e) => {
                  if (locked) return;
                  setDraft((d) => ({
                    ...d,
                    includeInputVat: e.target.checked,
                  }));
                  markDirty();
                }}
              />{" "}
              นำภาษีซื้อมารวมหักจากภาษีขาย
              <span className="muted">
                {" "}
                · ภาษีขายคำนวณเสมอ
                {!draft.includeInputVat
                  ? " · ตอนนี้เตรียมจ่ายขายเต็ม (ช่วงจด VAT)"
                  : ""}
              </span>
            </label>

            <p className="vat-net-strip" role="status">
              ภาษีขาย {fmt(view.outputVat)} − ภาษีซื้อ{" "}
              {fmt(view.inputVatApplied)}{" "}
              <span className="muted">
                {view.includeInputVat
                  ? `(GP ${fmt(view.inputGpVat)} + สองบช. ${fmt(view.inputBooksVat)})`
                  : `(มี ${fmt(view.inputVat)} แต่ยังไม่หัก)`}
              </span>{" "}
              = <strong>VAT สุทธิ {fmt(view.netVat)}</strong>
            </p>
          </div>

          <div className="vat-month-actions">
            {!locked ? (
              <>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy}
                  onClick={() => void saveDraft("draft")}
                >
                  ร่าง
                </button>
                <button
                  type="button"
                  className="vat-mini-btn vat-mini-btn--primary"
                  disabled={busy}
                  onClick={() => void saveDraft("saved")}
                >
                  บันทึก
                </button>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy || view.incomeTotal <= 0}
                  onClick={() => void trialToPnl()}
                >
                  รายได้ทดลอง → P&L
                </button>
                <button
                  type="button"
                  className="vat-mini-btn"
                  disabled={busy || view.incomeTotal <= 0}
                  onClick={() => void fileMonth()}
                >
                  ปิดงบจริง → ล็อก
                </button>
              </>
            ) : (
              <button
                type="button"
                className="vat-mini-btn"
                disabled={busy}
                onClick={() => void unlockMonth()}
              >
                ปลดล็อก
              </button>
            )}
          </div>
        </>
      )}

      {detailLine ? (
        <BooksVatEntryDetailModal
          book={detailLine.book}
          entryId={detailLine.id}
          locked={locked}
          onClose={() => setDetailLine(null)}
          onSaved={() => {
            void syncBooksFromLedgers(month, { writeVat: !locked });
            setDetailLine(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** ชื่อเก่า — ทดสอบ/ลิงก์ที่ยังเรียก VatMonthlyWorkbench */
export { VatMonthBooks as VatMonthlyWorkbench };
