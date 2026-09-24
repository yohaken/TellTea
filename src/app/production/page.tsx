"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Lock, ScrollText, Trash2, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { ModuleTabDock } from "@/components/ModuleTabDock";
import { ProdAddProductModal, ProdCatalogSetup } from "@/components/ProdCatalogSetup";
import { ProdPolicyPopup } from "@/components/ProdPolicyPopup";
import { EntryPhotoIndicator, ImagePreviewModal } from "@/components/EntryPhotoCell";
import { EntryTimestampsMeta } from "@/components/EntryTimestampsMeta";
import { PhotoAttachMultiField } from "@/components/PhotoAttachMultiField";
import { PhotoForensicsPanel } from "@/components/PhotoForensicsPanel";
import { ProdPhotoQaBatchPanel } from "@/components/ProdPhotoQaBatchPanel";
import { ProdPhotoQaConfirm } from "@/components/ProdPhotoQaConfirm";
import { ProdProductSummaryStrip, ProdWorkerSummaryStrip } from "@/components/ProdWorkSummaryStrip";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useStaffWorkBundle } from "@/hooks/useStaffWorkBundle";
import { useAuth } from "@/lib/auth";
import { monthInputValue, parseMonthInput } from "@/lib/bonus";
import { mapFirestoreError } from "@/lib/firestore-errors";
import { resolveWorkerDisplayNames } from "@/lib/employee-rename-propagate";
import { resolveLinkedEmployee, ensureStaffEmployeeLink } from "@/lib/employees";
import { staffHomeHref } from "@/lib/nav-menu";
import {
  workEntryCreditsEmployee,
} from "@/lib/work-entry-mine";
import { can } from "@/lib/permissions";
import {
  DEFAULT_PROD_POLICY,
  formatDeductRate,
  formatPolicyMoney,
  formatProdMinRange,
  productHasMinPolicy,
  subscribeProdPolicy,
  type ProdPolicySettings,
} from "@/lib/prod-policy";
import {
  entryHasPhotoFlag,
  type PhotoForensicsReport,
} from "@/lib/photo-forensics-scan";
import {
  prodEntryNeedsPhotoQaFix,
  prodPhotoQaBadgeLabel,
  prodPhotoQaBadgeTitle,
  runProdPhotoQaForSave,
  runOwnerEntryPhotoQaCheck,
  shouldRunProdPhotoConflictAi,
  buildProdPhotoQa,
  buildOwnerManualFlagPhotoQa,
  buildOwnerClearPhotoQa,
  type ProdPhotoQaConfirmKind,
  type VerifyProdPhotoConflictResult,
} from "@/lib/prod-photo-qa";
import {
  addProdEntry,
  computeProdBonus,
  deleteProdEntry,
  getProdImageUrls,
  isProdEntryLocked,
  isProdPhotoQaFlagged,
  labelProdStatus,
  listProdProducts,
  listProdWorkers,
  PROD_IMAGE_MAX,
  resolveProdEntryRates,
  seedProdCatalogIfEmpty,
  subscribeProdEntries,
  updateProdEntry,
  type ProdEntry,
  type ProdPhotoQa,
  type ProdProduct,
  type ProdWorker,
} from "@/lib/production";
import {
  buildProdProductCompareSummary,
  buildProdWorkerCompareSummary,
  shiftMonthInput,
} from "@/lib/prod-work-summary";
import {
  resolveRateForDate,
  subscribeRateSchedule,
  type RateScheduleEntry,
} from "@/lib/rate-schedule";
import {
  bangkokMonthRangeMs,
  bangkokDateKey,
  formatDateShortBe,
  formatPlainNumber,
  formatStockQty,
  parseDateInput,
  todayInputValue,
} from "@/lib/utils";

type ProdOwnerView = "log" | "catalog";

export default function ProductionPage() {
  return (
    <AuthGate>
      <ProductionView />
    </AuthGate>
  );
}

function ProductionView() {
  const { actorId, staff, isPermPreview, status: authStatus } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const canSetPolicy = isOwner && !isPermPreview;
  const shopProdView = isOwner || can(staff, "payrollPay");
  /** พรีวิว = มุมพนักงาน: ดู/เลือกเดือนได้ · กรอกไม่ได้ */
  const canWrite = !!actorId && !isPermPreview;
  const [ownerView, setOwnerView] = useState<ProdOwnerView>("log");
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [entries, setEntries] = useState<ProdEntry[]>([]);
  const [prevEntries, setPrevEntries] = useState<ProdEntry[]>([]);
  const [products, setProducts] = useState<ProdProduct[]>([]);
  const [workers, setWorkers] = useState<ProdWorker[]>([]);
  const [logMonth, setLogMonth] = useState(monthInputValue());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prodError, setProdError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProdEntry | null>(null);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleEntry[]>([]);
  const [policy, setPolicy] = useState<ProdPolicySettings>(DEFAULT_PROD_POLICY);
  const [policyReady, setPolicyReady] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyAutoShown, setPolicyAutoShown] = useState(false);
  const [policyTodayEntries, setPolicyTodayEntries] = useState<ProdEntry[] | null>(null);
  const [photoReport, setPhotoReport] = useState<PhotoForensicsReport | null>(null);
  const { year: logYear, month: logMonthIdx } = parseMonthInput(logMonth);

  const staffUseBundle = !shopProdView && !isPermPreview;

  const {
    status: staffBundleStatus,
    error: staffBundleError,
    productionBundle,
    retry: retryStaffBundle,
  } = useStaffWorkBundle({
    page: "production",
    month: logMonth,
    staff,
    authReady: authStatus === "ready",
    enabled: staffUseBundle && can(staff, "production"),
  });

  const effectiveEntries =
    staffUseBundle && productionBundle ? productionBundle.entries : entries;
  const effectiveRateSchedule =
    staffUseBundle && productionBundle ? productionBundle.rateSchedule : rateSchedule;
  const effectiveProducts =
    staffUseBundle && productionBundle ? productionBundle.products : products;
  const effectiveWorkers =
    staffUseBundle && productionBundle ? productionBundle.workers : workers;

  const prevMonth = useMemo(() => shiftMonthInput(logMonth, -1), [logMonth]);

  const forensicsRows = useMemo(
    () =>
      effectiveEntries.map((row) => ({
        entryId: row.id,
        entryDate: row.date,
        label: `${formatDateShortBe(row.date)} ${row.productName}`,
        imageUrls: getProdImageUrls(row),
      })),
    [effectiveEntries],
  );

  const photoQaRows = useMemo(
    () =>
      effectiveEntries.map((row) => ({
        entryId: row.id,
        entryDate: row.date,
        label: `${formatDateShortBe(row.date)} ${row.productName}`,
        productId: row.productId,
        productName: row.productName,
        imageUrls: getProdImageUrls(row),
        photoQa: row.photoQa,
      })),
    [effectiveEntries],
  );

  useEffect(() => {
    setPhotoReport(null);
  }, [logMonth, effectiveEntries.length]);

  // เดือนก่อน — เทียบจำนวนผลิต (ร้านทั้งร้าน / ของฉัน)
  useEffect(() => {
    if (authStatus !== "ready" || !can(staff, "production")) return;
    const { year, month } = parseMonthInput(prevMonth);
    if (!year) {
      setPrevEntries([]);
      return;
    }
    const window = bangkokMonthRangeMs(year, month);
    return subscribeProdEntries(
      (rows) => {
        if (shopProdView) {
          setPrevEntries(rows);
          return;
        }
        const roster = effectiveWorkers.length ? effectiveWorkers : workers;
        const linked = resolveLinkedEmployee(roster, staff);
        if (!linked) {
          setPrevEntries([]);
          return;
        }
        setPrevEntries(
          rows.filter((r) => workEntryCreditsEmployee(r, linked, roster, staff?.id)),
        );
      },
      (err) => setProdError(mapFirestoreError(err, "โหลดผลิตเดือนก่อน")),
      window,
    );
  }, [
    authStatus,
    staff,
    shopProdView,
    prevMonth,
    effectiveWorkers,
    workers,
  ]);

  const staffProdLoading = staffUseBundle && staffBundleStatus === "loading";
  const staffProdReady = staffUseBundle && staffBundleStatus === "ready";
  const pageLoading = loading || staffProdLoading;
  async function reloadCatalog() {
    const [p, w] = await Promise.all([listProdProducts(), listProdWorkers()]);
    setProducts(p);
    setWorkers(w);
  }

  useEffect(() => {
    if (staff && !can(staff, "production")) {
      router.replace(staffHomeHref(staff));
    }
  }, [staff, router]);

  useEffect(() => {
    if (authStatus !== "ready" || !can(staff, "production")) return;
    if (staffUseBundle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    let unsubEntries: (() => void) | undefined;
    const unsubSchedule = subscribeRateSchedule(
      (doc) => setRateSchedule(doc.entries),
      (err) => {
        if (shopProdView || isOwner) {
          setError(mapFirestoreError(err, "โหลดตารางเรท"));
        }
      },
    );

    void reloadCatalog()
      .then(async () => {
        if (isOwner) {
          const seeded = await seedProdCatalogIfEmpty();
          if (seeded.products || seeded.workers) await reloadCatalog();
        }
        if (cancelled) return;
        const w = await listProdWorkers();
        if (cancelled) return;
        setWorkers(w);
        // มุมพนักงาน/พรีวิว: โหลดเดือนแล้วกรองฝั่ง client (id + ชื่อ) — กัน employeeId ค้างแล้วรายการว่าง
        const monthWindow = bangkokMonthRangeMs(logYear, logMonthIdx);
        if (!shopProdView) {
          const linked = resolveLinkedEmployee(w, staff);
          if (linked && staff) {
            try {
              await ensureStaffEmployeeLink(staff, linked);
            } catch {
              /* best-effort */
            }
          }
          if (!linked) {
            setEntries([]);
            return;
          }
          unsubEntries = subscribeProdEntries(
            (rows) => {
              setEntries(
                rows.filter((r) =>
                  workEntryCreditsEmployee(r, linked, w, staff?.id),
                ),
              );
              setProdError(null);
            },
            (err) => setProdError(mapFirestoreError(err, "โหลดรายการผลิต")),
            monthWindow,
          );
          return;
        }
        unsubEntries = subscribeProdEntries(
          (rows) => {
            setEntries(rows);
            setProdError(null);
          },
          (err) => setProdError(mapFirestoreError(err, "โหลดรายการผลิต")),
          monthWindow,
        );
      })
      .catch((err) => setError(mapFirestoreError(err, "โหลดข้อมูลผลิต")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubEntries?.();
      unsubSchedule();
    };
  }, [authStatus, staff, isOwner, shopProdView, logYear, logMonthIdx, staffUseBundle]);

  useEffect(() => {
    if (authStatus !== "ready" || !can(staff, "production")) return;
    return subscribeProdPolicy((next) => {
      setPolicy(next);
      setPolicyReady(true);
    });
  }, [authStatus, staff]);

  useEffect(() => {
    if (policyAutoShown) return;
    if (authStatus !== "ready" || !can(staff, "production")) return;
    if (!policyReady) return;
    if (pageLoading) return;
    if (staffUseBundle && staffBundleStatus !== "ready") return;
    if (!policy.popupEnabled) {
      setPolicyAutoShown(true);
      return;
    }
    setPolicyOpen(true);
    setPolicyAutoShown(true);
  }, [
    policyAutoShown,
    authStatus,
    staff,
    policyReady,
    policy.popupEnabled,
    pageLoading,
    staffUseBundle,
    staffBundleStatus,
  ]);

  useEffect(() => {
    if (!policyOpen || !shopProdView) return;
    if (authStatus !== "ready" || !can(staff, "production")) return;
    const key = bangkokDateKey(Date.now());
    if (!key) return;
    const since = Date.parse(`${key}T00:00:00+07:00`);
    if (!Number.isFinite(since)) return;
    return subscribeProdEntries(
      (rows) => setPolicyTodayEntries(rows),
      (err) => setProdError(mapFirestoreError(err, "โหลดผลิตวันนี้")),
      { since, until: since + 86_400_000 },
    );
  }, [policyOpen, shopProdView, authStatus, staff]);

  useBodyScrollLock(formOpen);

  if (!can(staff, "production")) return null;

  const activeProducts = effectiveProducts.filter((p) => p.active);
  const activeWorkers = effectiveWorkers.filter((w) => w.active);
  const showCatalog = canSetPolicy && ownerView === "catalog";
  const showLog = !showCatalog;
  const policyDayLabel = formatDateShortBe(Date.now());

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(row: ProdEntry) {
    setEditing(row);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  const catalogTools = canSetPolicy ? (
    <div className="production-head-catalog-group" role="group" aria-label="สินค้าและเรท">
      <button
        type="button"
        className={
          ownerView === "catalog"
            ? "production-head-chip is-active"
            : "production-head-chip"
        }
        aria-pressed={ownerView === "catalog"}
        title={
          ownerView === "catalog"
            ? "กลับไปรายการผลิต"
            : "ดู/แก้รายการสินค้าและเรท"
        }
        onClick={() => {
          setOwnerView((v) => (v === "catalog" ? "log" : "catalog"));
          setFormOpen(false);
          setPolicyOpen(false);
        }}
      >
        {ownerView === "catalog" ? "← รายการ" : "สินค้า/เรท"}
        {ownerView !== "catalog" && products.length ? ` ${products.length}` : ""}
      </button>
      <button
        type="button"
        className="production-head-chip production-head-chip--add"
        title="เจ้าของเท่านั้น — เพิ่มชื่อขนม + เรทผลิต"
        onClick={() => {
          setAddProductOpen(true);
          setFormOpen(false);
          setPolicyOpen(false);
        }}
      >
        +สินค้า
      </button>
    </div>
  ) : null;

  return (
    <div className="module-page production-page">
      <div className="module-page-head production-page-head">
        <h1 className="panel-title module-page-title production-page-title">
          <ChefHat size={15} aria-hidden />
          ผลิต / โบนัส
        </h1>
        <div className="production-head-tools">
          {catalogTools}
          {showLog ? (
            <input
              type="month"
              className="ot-slim-input production-head-month"
              value={logMonth}
              onChange={(e) => setLogMonth(e.target.value)}
              aria-label="เดือนอ้างอิง"
            />
          ) : null}
          {canSetPolicy ? (
            <button
              type="button"
              className="ghost-btn prod-policy-toolbar-btn production-head-policy"
              onClick={() => setPolicyOpen(true)}
            >
              <ScrollText size={12} aria-hidden />
              นโยบาย
            </button>
          ) : null}
          {isOwner && showLog && !pageLoading ? (
            <>
              <PhotoForensicsPanel
                className="production-head-forensics"
                rows={forensicsRows}
                onReport={setPhotoReport}
                onPickEntry={(id) => {
                  const row = effectiveEntries.find((r) => r.id === id);
                  if (row && canWrite) openEdit(row);
                }}
              />
              <ProdPhotoQaBatchPanel
                className="production-head-photo-qa"
                rows={photoQaRows}
                products={effectiveProducts}
                onUpdatePhotoQa={async (entryId, photoQa) => {
                  await updateProdEntry(entryId, { photoQa }, actorId);
                }}
                onPickEntry={(id) => {
                  const row = effectiveEntries.find((r) => r.id === id);
                  if (row && canWrite) openEdit(row);
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {prodError ? <p className="error-text">{prodError}</p> : null}
      {staffBundleError && staffBundleStatus !== "loading" ? (
        <p className="error-text">
          {staffBundleError.message}
          <button type="button" className="btn-link" onClick={() => retryStaffBundle()}>
            ลองโหลดใหม่
          </button>
        </p>
      ) : null}
      {isPermPreview && showLog ? (
        <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.72rem" }}>
          พรีวิวมุมพนักงาน — เลือกเดือนดูรายการของคนนี้ได้ · กรอก/แก้ไม่ได้
        </p>
      ) : null}
      {pageLoading ? <p className="empty">กำลังโหลด...</p> : null}

      {!pageLoading && showCatalog ? (
        <ProdCatalogSetup
          products={products}
          wasteBonusPct={policy.wasteBonusPct}
          onReload={() => void reloadCatalog().catch((err) => setError((err as Error).message))}
          onError={setError}
        />
      ) : null}

      {canSetPolicy ? (
        <ProdAddProductModal
          open={addProductOpen}
          wasteBonusPct={policy.wasteBonusPct}
          shopSalesRate={
            resolveRateForDate(rateSchedule, "bakerySales", Date.now())?.rate ??
            undefined
          }
          onClose={() => setAddProductOpen(false)}
          onSaved={() => {
            void reloadCatalog().catch((err) => setError((err as Error).message));
          }}
          onError={setError}
        />
      ) : null}

      {!pageLoading && showLog && (shopProdView || staffProdReady) ? (
        <ProdTable
          entries={effectiveEntries}
          prevEntries={prevEntries}
          workers={effectiveWorkers}
          isOwner={isOwner}
          mineOnly={!shopProdView}
          canOpenRow={canWrite}
          month={logMonth}
          prevMonth={prevMonth}
          onEdit={openEdit}
          onError={setError}
          policy={policy}
          photoReport={photoReport}
          highlightWorkerId={
            resolveLinkedEmployee(effectiveWorkers, staff)?.id || null
          }
        />
      ) : null}

      {policyOpen ? (
        <ProdPolicyPopup
          open={policyOpen}
          onClose={() => setPolicyOpen(false)}
          products={effectiveProducts}
          entries={policyTodayEntries ?? effectiveEntries}
          policy={policy}
          canSetPolicy={canSetPolicy}
          actorId={actorId || ""}
          monthLabel={policyDayLabel}
          onOpenCatalog={
            canSetPolicy
              ? () => {
                  setPolicyOpen(false);
                  setOwnerView("catalog");
                  setFormOpen(false);
                }
              : undefined
          }
          onError={setError}
        />
      ) : null}

      {canWrite && formOpen && !pageLoading && showLog ? (
        <div
          className="modal-backdrop edit-modal is-module-form is-prod-form"
          onClick={closeForm}
        >
          <div className="modal-card prod-form-card" onClick={(e) => e.stopPropagation()}>
            <ProdEntryForm
              key={editing?.id || "new"}
              entry={editing}
              products={activeProducts}
              workers={activeWorkers}
              rateSchedule={effectiveRateSchedule}
              createdBy={actorId}
              isOwner={isOwner}
              staff={staff}
              mineOnly={!shopProdView}
              policy={policy}
              onError={setError}
              onSaved={closeForm}
              onCancelEdit={closeForm}
              onOpenCatalog={
                isOwner
                  ? () => {
                      setOwnerView("catalog");
                      setFormOpen(false);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}

      {canWrite && showLog ? (
        <ModuleTabDock
          ariaLabel="มุมมองผลิต"
          formOpen={formOpen}
          onAdd={openAdd}
        />
      ) : null}
      {/* พรีวิว: โชว์ปุ่ม + กรอกแบบพนักงาน แต่กดไม่ได้ — ให้สภาพแวดล้อมใกล้ของจริง */}
      {isPermPreview && showLog ? (
        <div className="module-tab-dock is-single" role="tablist" aria-label="มุมมองผลิต">
          <button
            type="button"
            role="tab"
            className="module-tab is-add"
            disabled
            title="พรีวิว — กรอกไม่ได้"
            aria-disabled="true"
          >
            + กรอก
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProdEntryForm({
  entry,
  products,
  workers,
  rateSchedule,
  createdBy,
  isOwner,
  staff,
  mineOnly,
  policy,
  onError,
  onSaved,
  onCancelEdit,
  onOpenCatalog,
}: {
  entry: ProdEntry | null;
  products: ProdProduct[];
  workers: ProdWorker[];
  rateSchedule: RateScheduleEntry[];
  createdBy: string;
  isOwner: boolean;
  staff: ReturnType<typeof useAuth>["staff"];
  mineOnly: boolean;
  policy: ProdPolicySettings;
  onError: (msg: string) => void;
  onSaved: () => void;
  onCancelEdit: () => void;
  onOpenCatalog?: () => void;
}) {
  const locked = entry ? isProdEntryLocked(entry) : false;
  const [date, setDate] = useState(entry ? todayInputValue(new Date(entry.date)) : todayInputValue());
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(() => {
    if (entry?.workerIds?.length) return entry.workerIds;
    if (!mineOnly) return [];
    const linked = resolveLinkedEmployee(workers, staff);
    if (linked && workers.some((w) => w.id === linked.id)) return [linked.id];
    return [];
  });
  const [productId, setProductId] = useState(entry?.productId || products[0]?.id || "");
  const [qty, setQty] = useState(
    entry ? String(Math.round(Number(entry.qtyProduced) || 0) || "") : "",
  );
  const [waste, setWaste] = useState(
    entry ? String(Math.round(Number(entry.qtyWaste) || 0)) : "",
  );
  const [note, setNote] = useState(entry?.note || "");
  const [imageUrls, setImageUrls] = useState<string[]>(() => getProdImageUrls(entry));
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingConflict, setPendingConflict] = useState<{
    kind: ProdPhotoQaConfirmKind;
    result: VerifyProdPhotoConflictResult;
    payload: {
      date: number;
      workerIds: string[];
      workerNames: string[];
      productId: string;
      productName: string;
      salesRate: number;
      prodRate: number;
      qtyProduced: number;
      qtyWaste: number;
      note: string;
      imageUrls: string[];
      imageUrl: string;
    };
  } | null>(null);
  /** Abort in-flight photo QA / persist if staff closes the form. */
  const saveGenRef = useRef(0);
  const footerGateRef = useRef<HTMLDivElement | null>(null);

  const formLocked = locked || analyzing || busy || !!pendingConflict;
  /** Allow ออก while AI runs — only block during Firestore write. */
  const closeBlocked = busy && !analyzing;

  useEffect(() => {
    if (!pendingConflict && !analyzing) return;
    footerGateRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pendingConflict, analyzing]);

  useEffect(() => {
    return () => {
      saveGenRef.current += 1;
    };
  }, []);

  const product = products.find((p) => p.id === productId) || null;
  const dateMs = parseDateInput(date);
  const rates = resolveProdEntryRates(entry, productId, product, {
    bakerySalesSchedule: rateSchedule,
    dateMs,
  });

  const preview = useMemo(() => {
    const names = workers.filter((w) => selectedWorkers.includes(w.id)).map((w) => w.name);
    return computeProdBonus({
      qtyProduced: Number(qty) || 0,
      salesRate: 0,
      prodRate: rates.prodRate,
      workerNames: names.length ? names : entry?.workerNames || [],
      qtyWaste: Number(waste) || 0,
    }, policy.wasteBonusPct);
  }, [qty, waste, rates.prodRate, selectedWorkers, workers, entry, policy.wasteBonusPct]);

  const policyProduct = product && productHasMinPolicy(product) ? product : null;
  const wasteMoneyPreview = preview.wasteDeduction;

  function toggleWorker(id: string) {
    if (formLocked) return;
    setSelectedWorkers((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  async function persistEntry(
    payload: {
      date: number;
      workerIds: string[];
      workerNames: string[];
      productId: string;
      productName: string;
      salesRate: number;
      prodRate: number;
      qtyProduced: number;
      qtyWaste: number;
      note: string;
      imageUrls: string[];
      imageUrl: string;
    },
    photoQa: ProdPhotoQa,
  ) {
    if (entry) {
      await updateProdEntry(entry.id, { ...payload, photoQa }, createdBy);
    } else {
      await addProdEntry({ ...payload, photoQa, createdBy });
    }
    onSaved();
  }

  async function finishWithQa(
    payload: {
      date: number;
      workerIds: string[];
      workerNames: string[];
      productId: string;
      productName: string;
      salesRate: number;
      prodRate: number;
      qtyProduced: number;
      qtyWaste: number;
      note: string;
      imageUrls: string[];
      imageUrl: string;
    },
    opts?: { staffConfirmedPhotoMatch?: boolean },
  ) {
    const gen = ++saveGenRef.current;
    setAnalyzing(true);
    try {
      const { photoQa, needsStaffConfirm, confirmKind, result } =
        await runProdPhotoQaForSave({
          productId: payload.productId,
          productName: payload.productName,
          imageUrls: payload.imageUrls,
          products,
          previous: entry?.photoQa,
          staffConfirmedPhotoMatch: opts?.staffConfirmedPhotoMatch,
        });

      if (gen !== saveGenRef.current) return;

      if (needsStaffConfirm && result && confirmKind) {
        setPendingConflict({ kind: confirmKind, result, payload });
        return;
      }

      setPendingConflict(null);
      await persistEntry(payload, photoQa);
    } finally {
      if (gen === saveGenRef.current) setAnalyzing(false);
    }
  }

  function requestClose() {
    if (closeBlocked) return;
    saveGenRef.current += 1;
    setAnalyzing(false);
    setPendingConflict(null);
    onCancelEdit();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (locked || analyzing || pendingConflict) return;
    if (!createdBy) return;
    const chosen = workers.filter((w) => selectedWorkers.includes(w.id));
    if (!chosen.length) {
      onError("เลือกพนักงานอย่างน้อย 1 คน");
      return;
    }
    const prod = products.find((p) => p.id === productId);
    if (!prod && !entry) {
      onError("เลือกสินค้า");
      return;
    }
    const urls = imageUrls.filter(Boolean).slice(0, PROD_IMAGE_MAX);
    if (!urls.length) {
      onError("ถ่ายรูปอย่างน้อย 1 รูปก่อนบันทึก");
      return;
    }
    if (urls.some((u) => u.startsWith("data:"))) {
      onError("รูปเก่ายังฝังในเอกสาร — ลบแล้วแนบใหม่เพื่อบันทึกเข้าคลังหลักฐาน");
      return;
    }
    setBusy(true);
    try {
      const entryDateMs = parseDateInput(date);
      const resolved = resolveProdEntryRates(entry, productId, prod ?? null, {
        bakerySalesSchedule: rateSchedule,
        dateMs: entryDateMs,
      });
      const payload = {
        date: entryDateMs,
        workerIds: chosen.map((w) => w.id),
        workerNames: chosen.map((w) => w.name),
        productId: prod?.id || entry!.productId,
        productName: prod?.name || entry!.productName,
        salesRate: 0,
        prodRate: resolved.prodRate,
        qtyProduced: Math.max(0, Math.round(Number(qty) || 0)),
        qtyWaste: Math.max(0, Math.round(Number(waste) || 0)),
        note,
        imageUrls: urls,
        imageUrl: urls[0] || "",
      };
      await finishWithQa(payload);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmCorrect() {
    if (!pendingConflict || locked) return;
    const { payload, result } = pendingConflict;
    setBusy(true);
    try {
      const photoQa = buildProdPhotoQa({
        productId: payload.productId,
        productName: payload.productName,
        result,
        staffConfirmedPhotoMatch: true,
        previous: entry?.photoQa,
      });
      await persistEntry(payload, photoQa);
      setPendingConflict(null);
    } catch (err) {
      onError((err as Error).message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function onRejectChangeProduct() {
    if (!pendingConflict) return;
    const suggested = pendingConflict.result.suggestedProductName?.trim();
    setPendingConflict(null);
    if (suggested) {
      const want = suggested.trim();
      const match = products.find((p) => p.name.trim() === want);
      if (match) setProductId(match.id);
    }
    onError("เปลี่ยนสินค้าให้ตรงกับรูป แล้วบันทึกอีกครั้ง");
  }

  return (
    <form
      className="form-card entry-form module-entry-form prod-entry-form"
      onSubmit={(e) => void onSubmit(e)}
    >
      <div className="entry-toolbar module-form-head prod-form-head">
        <h2 className="panel-title">
          {entry ? (locked ? "ดูรายการ" : "แก้รายการ") : "บันทึกผลิต"}
        </h2>
        <button
          type="button"
          className="ghost-btn icon-btn"
          aria-label="ปิด"
          disabled={closeBlocked}
          onClick={requestClose}
        >
          <X size={18} />
        </button>
      </div>

      <div className="prod-form-body">
        {entry ? (
          <EntryTimestampsMeta
            entryDate={entry.date}
            createdAt={entry.createdAt}
            updatedAt={entry.updatedAt}
            era="be"
          />
        ) : null}

        {isProdPhotoQaFlagged(entry) ? (
          <p className="prod-photo-qa-banner" role="status">
            {entry?.photoQa?.verifyStatus === "pending"
              ? "ให้ตรวจสอบรายการอีกครั้ง — รูปกับสินค้ายังไม่ยืนยัน · พักโบนัส"
              : "รายการไม่ตรง · พักโบนัสจนกว่าจะแก้แล้วบันทึกใหม่"}
          </p>
        ) : null}

        {isOwner && entry && !locked ? (
          <div className="prod-photo-qa-owner-actions" aria-label="เครื่องมือเจ้าของ">
            <button
              type="button"
              className="ghost-btn"
              disabled={
                busy ||
                analyzing ||
                !imageUrls.filter(Boolean).length ||
                !shouldRunProdPhotoConflictAi(
                  products.find((p) => p.id === productId)?.name || entry.productName,
                )
              }
              title="เจ้าของเท่านั้น — สั่ง AI ตรวจรูปกับสินค้าในรายการนี้"
              onClick={() => {
                void (async () => {
                  setAnalyzing(true);
                  try {
                    const name =
                      products.find((p) => p.id === productId)?.name ||
                      entry.productName;
                    const check = await runOwnerEntryPhotoQaCheck({
                      productId: productId || entry.productId,
                      productName: name,
                      imageUrls,
                      products,
                      previous: entry.photoQa,
                    });
                    if (!check.ok) {
                      onError(check.message);
                      return;
                    }
                    await updateProdEntry(
                      entry.id,
                      { photoQa: check.photoQa },
                      createdBy,
                    );
                    onSaved();
                  } catch (err) {
                    onError((err as Error).message || "ตรวจ AI ไม่สำเร็จ");
                  } finally {
                    setAnalyzing(false);
                  }
                })();
              }}
            >
              {analyzing ? "กำลังตรวจ…" : "ตรวจ AI"}
            </button>
            {isProdPhotoQaFlagged(entry) ? (
              <button
                type="button"
                className="ghost-btn"
                disabled={busy || analyzing}
                title="เจ้าของเท่านั้น — ปลดป้าย นับโบนัสได้"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const photoQa = buildOwnerClearPhotoQa({
                        productId: productId || entry.productId,
                        productName:
                          products.find((p) => p.id === productId)?.name ||
                          entry.productName,
                        previous: entry.photoQa,
                      });
                      await updateProdEntry(entry.id, { photoQa }, createdBy);
                      onSaved();
                    } catch (err) {
                      onError((err as Error).message || "ปลดป้ายไม่สำเร็จ");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                ปลดป้าย
              </button>
            ) : (
              <button
                type="button"
                className="ghost-btn prod-photo-qa-flag-btn"
                disabled={busy || analyzing}
                title="เจ้าของเท่านั้น — ติดป้ายมือ รูปไม่ตรง"
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const photoQa = buildOwnerManualFlagPhotoQa({
                        productId: productId || entry.productId,
                        productName:
                          products.find((p) => p.id === productId)?.name ||
                          entry.productName,
                        previous: entry.photoQa,
                        reason: "เจ้าของติดป้ายมือ — รูปไม่ตรงสินค้า",
                      });
                      await updateProdEntry(entry.id, { photoQa }, createdBy);
                      onSaved();
                    } catch (err) {
                      onError((err as Error).message || "ติดป้ายไม่สำเร็จ");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                ติดป้ายมือ
              </button>
            )}
          </div>
        ) : null}

        {locked ? (
          <p className="muted form-hint-inline prod-locked-hint">
            <Lock size={14} aria-hidden /> จ่ายแล้ว — ล็อกเรท/ยอด
          </p>
        ) : null}

        {!products.length || !workers.length ? (
          <p className="muted form-hint-inline">
            ยังไม่มีสินค้าหรือพนักงาน —{" "}
            {isOwner && onOpenCatalog && !products.length ? (
              <button type="button" className="linkish-btn" onClick={onOpenCatalog}>
                ไปแท็บสินค้า / เรท
              </button>
            ) : (
              "รอเจ้าของตั้งค่า"
            )}
          </p>
        ) : null}

        <div className="field prod-form-date">
          <label htmlFor="prod-date">วันที่</label>
          <input
            id="prod-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={formLocked}
          />
        </div>
        <div className="field prod-form-product">
          <label htmlFor="prod-product">สินค้า</label>
          <select
            id="prod-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            required
            disabled={formLocked}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {policyProduct ? (
          <p className="prod-policy-chip">
            ขั้นต่ำ {formatProdMinRange(policyProduct.minQtyLow, policyProduct.minQtyHigh)}
            /วัน
            {wasteMoneyPreview > 0 ? ` · หัก ${formatPolicyMoney(wasteMoneyPreview)}` : ""}
          </p>
        ) : null}

        {entry && !locked && productId !== entry.productId ? (
          <p className="muted check-hint">เปลี่ยนสินค้า → เรทใหม่</p>
        ) : null}

        <div className="field prod-form-workers">
          <span className="field-label">พนักงาน (สูงสุด 2)</span>
          <div className="suggest-list">
            {workers.map((w) => {
              const on = selectedWorkers.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  className={on ? "suggest-chip is-active" : "suggest-chip"}
                  onClick={() => toggleWorker(w.id)}
                  disabled={formLocked}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="stock-form-grid prod-form-qty-grid">
          <div className="field">
            <label htmlFor="prod-qty">ผลิต</label>
            <input
              id="prod-qty"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
              disabled={formLocked}
            />
          </div>
          <div className="field">
            <label htmlFor="prod-waste">ทิ้ง/เสีย</label>
            <input
              id="prod-waste"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={waste}
              onChange={(e) => setWaste(e.target.value)}
              placeholder="0"
              disabled={formLocked}
            />
          </div>
          <div className="field">
            <label htmlFor="prod-note">หมายเหตุ</label>
            <input
              id="prod-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoComplete="off"
              disabled={formLocked}
              placeholder="—"
            />
          </div>
        </div>

        {imageUrls.length || !locked ? (
          <PhotoAttachMultiField
            values={imageUrls}
            onChange={setImageUrls}
            onError={onError}
            label="ถ่ายรูป"
            max={PROD_IMAGE_MAX}
            storageFolder="production"
            storageSlotKey={entry?.id || "new"}
            hint={
              isOwner
                ? "บังคับ ≥1 รูปสด · กลุ่มมันตรวจ AI"
                : "บังคับ ≥1 รูปสดจากกล้อง"
            }
            allowCamera
            allowGallery={false}
            requireLiveCapture
            readOnly={formLocked}
          />
        ) : null}

        {locked ? (
          <p className="muted form-hint-inline prod-form-preview">
            {formatPlainNumber(preview.income)} − {formatPlainNumber(preview.wasteDeduction)} ={" "}
            {formatPlainNumber(preview.prodBonus)} · /คน {formatPlainNumber(preview.bonusPerPerson)}
          </p>
        ) : Number(qty) > 0 && selectedWorkers.length > 0 ? (
          <p className="muted form-hint-inline prod-form-preview">
            {formatPlainNumber(preview.income)} − {formatPlainNumber(preview.wasteDeduction)} ={" "}
            {formatPlainNumber(preview.prodBonus)} · /คน {formatPlainNumber(preview.bonusPerPerson)}
          </p>
        ) : null}
      </div>

      <div className="prod-form-footer-gate" ref={footerGateRef}>
        {analyzing ? (
          <p className="prod-photo-qa-analyzing" role="status">
            {isOwner ? "กำลังตรวจ AI…" : "กำลังตรวจรูป… กดออกได้ถ้าต้องการยกเลิก"}
          </p>
        ) : null}
        {pendingConflict ? (
          <ProdPhotoQaConfirm
            kind={pendingConflict.kind}
            selectedProductName={pendingConflict.payload.productName}
            suggestedProductName={pendingConflict.result.suggestedProductName}
            reason={pendingConflict.result.reason}
            busy={busy || analyzing}
            onConfirmCorrect={() => void onConfirmCorrect()}
            onRejectChange={onRejectChangeProduct}
            onCancel={() => setPendingConflict(null)}
          />
        ) : null}
      </div>

      <div className="entry-actions module-form-actions prod-form-actions">
        {!locked && !pendingConflict ? (
          <button
            type="submit"
            className="primary-btn action-out"
            disabled={formLocked || !products.length}
          >
            {analyzing ? "ตรวจรูป…" : busy ? "บันทึก…" : "บันทึก"}
          </button>
        ) : null}
        <button
          type="button"
          className="ghost-btn"
          disabled={closeBlocked}
          onClick={requestClose}
        >
          {locked ? "ปิด" : "ออก"}
        </button>
      </div>
    </form>
  );
}

function ProdTable({
  entries,
  prevEntries,
  workers,
  isOwner,
  mineOnly,
  canOpenRow,
  month,
  prevMonth,
  onEdit,
  onError,
  policy,
  photoReport,
  highlightWorkerId,
}: {
  entries: ProdEntry[];
  prevEntries: ProdEntry[];
  workers: ProdWorker[];
  isOwner: boolean;
  /** true = มุมพนักงาน (รายการของฉัน) — ซ่อนคอลัมน์พนักงาน */
  mineOnly: boolean;
  /** false = พรีวิว/อ่านอย่างเดียว — ไม่เปิดฟอร์มแก้ */
  canOpenRow: boolean;
  month: string;
  prevMonth: string;
  onEdit: (row: ProdEntry) => void;
  onError: (msg: string | null) => void;
  policy: ProdPolicySettings;
  photoReport: PhotoForensicsReport | null;
  highlightWorkerId?: string | null;
}) {
  const [preview, setPreview] = useState<{
    urls: string[];
    title: string;
    entryDateMs?: number;
  } | null>(null);

  useBodyScrollLock(!!preview);

  // entries ถูก scope ตามเดือน (+ workerId มุมพนักงาน) จาก parent แล้ว
  const filtered = entries;

  const productSummary = useMemo(
    () => buildProdProductCompareSummary(entries, prevEntries),
    [entries, prevEntries],
  );
  const workerSummary = useMemo(
    () => buildProdWorkerCompareSummary(entries, prevEntries),
    [entries, prevEntries],
  );

  async function onDelete(row: ProdEntry) {
    if (!isOwner) return;
    const locked = isProdEntryLocked(row);
    const ok = window.confirm(
      locked
        ? `รายการนี้จ่ายแล้ว — ลบถาวร?\n${formatDateShortBe(row.date)} · ${row.productName}\n\nยอดจะหายจากสรุปโบนัสเดือนนี้`
        : "ลบรายการนี้?",
    );
    if (!ok) return;
    try {
      await deleteProdEntry(row.id, { asOwner: true });
    } catch (err) {
      onError((err as Error).message || "ลบไม่สำเร็จ");
    }
  }

  return (
    <>
      <div className="prod-work-summary-duo">
        <ProdProductSummaryStrip
          month={month}
          prevMonth={prevMonth}
          summary={productSummary}
        />
        <ProdWorkerSummaryStrip
          month={month}
          prevMonth={prevMonth}
          summary={workerSummary}
          highlightWorkerId={highlightWorkerId}
        />
      </div>

      {!entries.length ? (
        <p className="empty">
          {mineOnly
            ? "ยังไม่มีรายการผลิตของคุณในเดือนนี้"
            : "ยังไม่มีรายการผลิตในเดือนนี้ — กด + กรอก ด้านล่างเพื่อเริ่ม"}
        </p>
      ) : (
        <div className="sheet-wrap production-sheet sheet-bleed">
          <table className="sheet-table prod-table sheet-table--dense">
            <thead>
              <tr>
                <th className="col-date">วันที่</th>
                {mineOnly ? null : (
                  <th className="col-desc prod-col-worker">พนักงาน</th>
                )}
                <th className="col-desc prod-col-product col-sticky-left">สินค้า</th>
                <th className="col-out prod-col-qty">
                  ผลิต
                  {isOwner ? <span className="prod-th-sub">เรทผลิต</span> : null}
                </th>
                <th className="col-out prod-col-waste">
                  ทิ้ง/เสีย
                  {isOwner ? <span className="prod-th-sub">เรทเสีย</span> : null}
                </th>
                <th className="col-note">หมายเหตุ</th>
                {isOwner ? (
                  <>
                    <th className="col-out prod-col-bonus">
                      โบนัสผลิต
                      <span className="prod-th-sub">รายได้−หัก</span>
                    </th>
                    <th className="col-act">คน</th>
                  </>
                ) : null}
                <th className="col-out">โบนัส/คน</th>
                <th className="col-act">สถานะ</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const c = computeProdBonus(row, policy.wasteBonusPct);
                const locked = isProdEntryLocked(row);
                const qaFlagged = prodEntryNeedsPhotoQaFix(row);
                const qaBadge = prodPhotoQaBadgeLabel(row);
                const photoFlagged = isOwner && entryHasPhotoFlag(photoReport, row.id);
                const flagHints = photoReport?.byEntryId[row.id]?.hints || [];
                const bonusHeld = isProdPhotoQaFlagged(row);
                return (
                  <tr
                    key={row.id}
                    className={[
                      locked ? "row-out prod-row-paid" : "row-out",
                      photoFlagged ? "is-photo-flag" : "",
                      qaFlagged ? "is-photo-qa-flag" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td className="col-date">{formatDateShortBe(row.date)}</td>
                    {mineOnly ? null : (
                      <td className="col-desc prod-col-worker">
                        {resolveWorkerDisplayNames(row.workerIds, row.workerNames, workers).join(
                          ", ",
                        ) || "—"}
                      </td>
                    )}
                    <td className="col-desc prod-col-product col-sticky-left">
                      <div className="prod-name-row">
                        <button
                          type="button"
                          className="desc-link"
                          title={
                            canOpenRow
                              ? row.productName
                              : `${row.productName} · ดูอย่างเดียว`
                          }
                          onClick={() => {
                            if (canOpenRow) onEdit(row);
                          }}
                          disabled={!canOpenRow}
                        >
                          {locked ? <Lock size={11} aria-hidden /> : null} {row.productName}
                        </button>
                        {qaBadge ? (
                          <span
                            className="prod-photo-qa-badge"
                            title={prodPhotoQaBadgeTitle(row) || undefined}
                          >
                            {qaBadge}
                          </span>
                        ) : null}
                        <EntryPhotoIndicator
                          imageUrl={row.imageUrl}
                          imageUrls={row.imageUrls}
                          label={row.productName}
                          flagged={photoFlagged || qaFlagged}
                          flagTitle={
                            qaFlagged
                              ? prodPhotoQaBadgeTitle(row) || "ให้ตรวจสอบรายการอีกครั้ง"
                              : flagHints.join(" · ") || undefined
                          }
                          onView={(urls) =>
                            setPreview({ urls, title: row.productName, entryDateMs: row.date })
                          }
                        />
                      </div>
                    </td>
                    <td className="col-out prod-col-qty">
                      {formatStockQty(row.qtyProduced)}
                      {isOwner ? (
                        <span className="prod-qty-rate">{formatPlainNumber(row.prodRate)}</span>
                      ) : null}
                    </td>
                    <td className="col-out prod-col-waste">
                      {row.qtyWaste ? formatStockQty(row.qtyWaste) : "—"}
                      {isOwner ? (
                        <span className="prod-waste-rate">
                          {formatDeductRate(c.wasteRate) || "—"}
                        </span>
                      ) : null}
                      {c.wasteDeduction > 0 ? (
                        <span className="prod-waste-money">หัก {formatPlainNumber(c.wasteDeduction)}</span>
                      ) : null}
                    </td>
                    <td className="col-note" title={row.note || ""}>{row.note || ""}</td>
                    {isOwner ? (
                      <>
                        <td className="col-out prod-col-bonus">
                          {bonusHeld ? (
                            <span className="prod-bonus-held" title="ไม่นับโบนัสจนกว่าจะแก้">
                              พักโบนัส
                            </span>
                          ) : (
                            <>
                              <span className="prod-bonus-eq">
                                {formatPlainNumber(c.income)} − {formatPlainNumber(c.wasteDeduction)}
                              </span>
                              <span className="prod-bonus-sum">
                                = {formatPlainNumber(c.prodBonus)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="col-act">{c.workerCount}</td>
                      </>
                    ) : null}
                    <td className="col-out">
                      {bonusHeld ? "—" : formatPlainNumber(c.bonusPerPerson)}
                    </td>
                    <td className="col-act">
                      <span
                        className={
                          row.status === "paid" ? "prod-status-pill is-paid" : "prod-status-pill"
                        }
                      >
                        {labelProdStatus(row.status)}
                      </span>
                    </td>
                    <td className="col-act">
                      <div className="prod-row-actions">
                        {isOwner ? (
                          <button
                            type="button"
                            className="trash-btn"
                            aria-label={locked ? "ลบรายการที่จ่ายแล้ว" : "ลบ"}
                            title={
                              locked
                                ? "ลบได้แม้จ่ายแล้ว (เจ้าของร้าน)"
                                : "ลบรายการ"
                            }
                            onClick={() => void onDelete(row)}
                          >
                            <Trash2 size={11} strokeWidth={2.25} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {preview ? (
        <ImagePreviewModal
          urls={preview.urls}
          title={preview.title}
          entryDateMs={preview.entryDateMs}
          showCaptureMeta={isOwner}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
