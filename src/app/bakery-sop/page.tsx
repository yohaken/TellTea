"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Minus,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useAuth } from "@/lib/auth";
import { mapFirestoreError } from "@/lib/firestore-errors";
import { staffHomeHref } from "@/lib/nav-menu";
import { can } from "@/lib/permissions";
import {
  analyzeMenuSopCost,
  extractStockCostsFromBill,
  type BillCostLineProposal,
} from "@/lib/menu-sop-ai";
import {
  legacySopDraftForName,
} from "@/lib/menu-sop-legacy-notes";
import {
  computeMenuSopCostSummary,
  encodeMenuSopBaseRef,
  ingredientLinkHasPair,
  isBaseSop,
  labelMenuSopSummaryStatus,
  menuSopDraftChecks,
  menuSopSummaryStatus,
  parseMenuSopIngredientRef,
  patchMenuSopWorkFlags,
  setMenuSopIngredientLinks,
  subscribeMenuSopCost,
  subscribeMenuSops,
  updateMenuSop,
  upsertMenuSopBase,
  upsertMenuSopForMenuItem,
  type MenuSop,
  type MenuSopDraftChecks,
  type MenuSopIngredient,
  type MenuSopIngredientLink,
  type MenuSopSummaryStatus,
} from "@/lib/menu-sop";
import {
  listRecentLedgerEntries,
  getLedgerReceiptUrls,
} from "@/lib/ledger";
import type { LedgerEntry, MenuCategory, MenuItem } from "@/lib/types";
import { setStockUnitCost, convertUnitCost, stockUnitsCompatible } from "@/lib/stock-costs";
import {
  addStockAliasIfNew,
  findStockByNameOrAlias,
  normalizeStockUnit,
  STOCK_UNIT_OPTIONS,
  subscribeStockItems,
  subscribeStockItemsWithCosts,
} from "@/lib/stock";
import type { StockItem } from "@/lib/types";
import { formatPlainNumber } from "@/lib/utils";
import { getDoc, doc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  subscribeMenuCategories,
  subscribeMenuItems,
} from "@/lib/pos-menu";
import { setMenuDbMode } from "@/lib/pos-menu-db";

type DetailTab = "draft" | "cost";

function isCategoryArchived(cat: MenuCategory): boolean {
  return cat.active === false;
}

function isItemArchived(item: MenuItem): boolean {
  return item.active === false && item.visibleOnPos === false;
}

function StatusMark({
  ok,
  label,
  tone,
}: {
  ok: boolean;
  label: string;
  /** เบส — สีใหม่แยกจากคลัง/เมนู */
  tone?: "base";
}) {
  const toneCls = tone === "base" ? " is-base" : "";
  return (
    <span
      className={
        ok
          ? `bakery-sop-mark is-ok${toneCls}`
          : `bakery-sop-mark is-miss${toneCls}`
      }
      title={ok ? `${label} ครบ` : `ขาด ${label}`}
      aria-label={ok ? `${label} ครบ` : `ขาด ${label}`}
    >
      {ok ? <Check size={12} strokeWidth={3} aria-hidden /> : <Minus size={12} aria-hidden />}
    </span>
  );
}

function DraftStatusCells({
  checks,
  skipped,
  isBase,
}: {
  checks: MenuSopDraftChecks;
  skipped: boolean;
  /** แถวกลุ่มเบส — เช็กลิสต์ + สีใหม่ */
  isBase?: boolean;
}) {
  if (skipped) {
    return (
      <td className="bakery-sop-status-skip-cell">
        <span className="bakery-sop-skip-pill">ข้าม</span>
      </td>
    );
  }
  return (
    <td className="bakery-sop-mark-cell">
      <StatusMark
        ok={checks.ingredients}
        label={isBase ? "เบส·ส่วนผสม" : "ส่วนผสม"}
        tone={isBase ? "base" : undefined}
      />
    </td>
  );
}

function SummaryStatusCell({
  status,
  missingLabels,
  isBase,
}: {
  status: MenuSopSummaryStatus;
  missingLabels: string[];
  isBase?: boolean;
}) {
  const label = labelMenuSopSummaryStatus(status);
  const title =
    status === "pending" && missingLabels.length
      ? `ขาด ${missingLabels.join(" · ")}`
      : isBase
        ? `เบส · ${label}`
        : label;
  const baseCls = isBase ? " is-base" : "";
  return (
    <td className="bakery-sop-summary-cell">
      <span
        className={
          status === "done"
            ? `bakery-sop-summary-pill is-done${baseCls}`
            : status === "skipped"
              ? `bakery-sop-summary-pill is-skip${baseCls}`
              : `bakery-sop-summary-pill is-pending${baseCls}`
        }
        title={title}
      >
        {isBase && status !== "skipped" ? `เบส·${label}` : label}
      </span>
    </td>
  );
}

/** ถามก่อนดึงสูตรเดิม — โชว์แค่ข้อความส่วนผสม ไม่โชว์จับคู่คลังจากชีต */
function confirmPullLegacyDraft(
  menuName: string,
  ingredientsText: string,
): boolean {
  const preview = String(ingredientsText || "").trim().slice(0, 280);
  const more = String(ingredientsText || "").trim().length > 280 ? "…" : "";
  return window.confirm(
    `มีสูตรเดิมของ «${menuName}»\n\n${preview}${more}\n\nดึงใส่ส่วนผสมไหม?`,
  );
}

/** ปุ่มดึงสูตรเดิม — ถามก่อนใส่ · ไม่ดึงโน้ตจับคู่คลัง */
function LegacyDraftImportButton({
  menuName,
  canWrite,
  disabled,
  onApply,
}: {
  menuName: string;
  canWrite: boolean;
  disabled?: boolean;
  onApply: (draft: NonNullable<ReturnType<typeof legacySopDraftForName>>) => void;
}) {
  const draft = legacySopDraftForName(menuName);
  if (!draft?.ingredientsText || !canWrite) return null;
  return (
    <button
      type="button"
      className="btn bakery-sop-fit-btn bakery-sop-legacy-import-btn"
      disabled={disabled}
      title="ดึงสูตรเดิมใส่ส่วนผสม (ถามก่อน)"
      onClick={() => {
        if (!confirmPullLegacyDraft(menuName, draft.ingredientsText)) return;
        onApply(draft);
      }}
    >
      ดึงสูตรเดิม
    </button>
  );
}

function GroupMetaCells({
  done,
  total,
  isOwner,
}: {
  done: number;
  total: number;
  isOwner: boolean;
}) {
  return (
    <>
      <td className="bakery-sop-group-meta muted">
        {done}/{total}
      </td>
      <td className="bakery-sop-summary-cell muted">
        {done}/{total} เสร็จ
      </td>
      <td className="bakery-sop-mark-cell" />
      {isOwner ? <td className="bakery-sop-mark-cell" /> : null}
    </>
  );
}

export default function BakerySopPage() {
  return (
    <AuthGate>
      <Suspense fallback={null}>
        <BakerySopView />
      </Suspense>
    </AuthGate>
  );
}

function BakerySopView() {
  const { actorId, staff, isPermPreview, status: authStatus } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOwner = staff?.role === "owner";
  const canWrite = !!actorId && !isPermPreview;
  /** ต้นทุน (฿) — เจ้าของเท่านั้น · พนักงานกรอกชื่อ/ปริมาณอย่างเดียว (กฎ bakery-sop-cost-owner-only) */
  const canSeeCost = isOwner && !isPermPreview;
  /** คอลัมน์เมนู: ชื่อ + ผสม + สถานะ + ข้าม + (โฟกัสถ้าเจ้าของ) */
  const menuTableColCount = isOwner ? 5 : 4;
  /** คอลัมน์เบส: ชื่อ + ได้ + ผสม + สถานะ + ข้าม + (โฟกัสถ้าเจ้าของ) */
  const baseTableColCount = isOwner ? 6 : 5;

  const [sops, setSops] = useState<MenuSop[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  /** id ของเบส หรือ "__new__" เมื่อสร้างใหม่ */
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [baseOpen, setBaseOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("draft");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [menuReady, setMenuReady] = useState(false);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!can(staff, "bakerySop")) {
      router.replace(staffHomeHref(staff));
    }
  }, [authStatus, staff, router]);

  useEffect(() => {
    if (authStatus !== "ready" || !can(staff, "bakerySop")) return;
    return subscribeMenuSops(setSops, (e) => setErr(mapFirestoreError(e)));
  }, [authStatus, staff]);

  useEffect(() => {
    if (authStatus !== "ready" || !can(staff, "bakerySop")) return;
    setMenuDbMode("owner");
    let catsOk = false;
    let itemsOk = false;
    const mark = () => {
      if (catsOk && itemsOk) setMenuReady(true);
    };
    const u1 = subscribeMenuCategories(
      (list) => {
        setCategories(list);
        catsOk = true;
        mark();
      },
      (e) => setErr(mapFirestoreError(e)),
    );
    const u2 = subscribeMenuItems(
      (list) => {
        setMenuItems(list);
        itemsOk = true;
        mark();
      },
      (e) => setErr(mapFirestoreError(e)),
    );
    return () => {
      u1();
      u2();
      setMenuDbMode("pos");
    };
  }, [authStatus, staff]);

  const baseSops = useMemo(() => {
    return sops
      .filter((s) => isBaseSop(s) && s.active !== false)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [sops]);

  const sopByMenuId = useMemo(() => {
    const m = new Map<string, MenuSop>();
    for (const s of sops) {
      if (s.menuItemId && !isBaseSop(s)) m.set(s.menuItemId, s);
    }
    return m;
  }, [sops]);

  const tree = useMemo(() => {
    // โครงเดียวกับเมนูหลังร้าน — พนักงานเห็นทั้งหมด · สถานะเสร็จสรุปจากเช็กลิสต์
    const cats = categories
      .filter((c) => !isCategoryArchived(c))
      .slice()
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
      );
    return cats.map((cat) => {
      const items = menuItems
        .filter((m) => m.categoryId === cat.id && !isItemArchived(m))
        .slice()
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th"),
        );
      return { cat, items };
    });
  }, [categories, menuItems]);

  /** ลิงก์ตรง: /bakery-sop/?menuId=… หรือ ?menu=ชื่อ (contains) */
  // หมวด/เบสหุบไว้ก่อน — กดขยายเมื่อต้องการ (ลิงก์ตรงยังขยายหมวดนั้นได้)
  useEffect(() => {
    if (!menuReady || !menuItems.length) return;
    const menuId = String(searchParams.get("menuId") || "").trim();
    const menuQ = String(searchParams.get("menu") || "").trim();
    if (menuId) {
      const hit = menuItems.find((m) => m.id === menuId);
      if (hit) {
        setSelectedMenuId(hit.id);
        setSelectedBaseId(null);
        setTab("draft");
        const catId = hit.categoryId;
        if (catId) {
          setExpandedCats((prev) => {
            if (prev.has(catId)) return prev;
            const next = new Set(prev);
            next.add(catId);
            return next;
          });
        }
      }
      return;
    }
    if (menuQ) {
      const q = menuQ.toLowerCase();
      const hit =
        menuItems.find((m) => m.name.trim().toLowerCase() === q) ||
        menuItems.find((m) => m.name.toLowerCase().includes(q));
      if (hit) {
        setSelectedMenuId(hit.id);
        setSelectedBaseId(null);
        setTab("draft");
        const catId = hit.categoryId;
        if (catId) {
          setExpandedCats((prev) => {
            if (prev.has(catId)) return prev;
            const next = new Set(prev);
            next.add(catId);
            return next;
          });
        }
      }
    }
  }, [menuReady, menuItems, searchParams]);

  const selectedItem = useMemo(
    () => menuItems.find((m) => m.id === selectedMenuId) || null,
    [menuItems, selectedMenuId],
  );

  const selectedSop = useMemo(
    () => (selectedMenuId ? sopByMenuId.get(selectedMenuId) || null : null),
    [selectedMenuId, sopByMenuId],
  );

  const selectedBase = useMemo(() => {
    if (!selectedBaseId || selectedBaseId === "__new__") return null;
    return (
      sops.find((s) => s.id === selectedBaseId && isBaseSop(s)) || null
    );
  }, [selectedBaseId, sops]);

  const baseFilledCount = useMemo(
    () =>
      baseSops.filter((s) => menuSopDraftChecks(s).complete || s.skipped)
        .length,
    [baseSops],
  );

  const filledCount = useMemo(() => {
    let n = 0;
    for (const branch of tree) {
      for (const it of branch.items) {
        const sop = sopByMenuId.get(it.id);
        if (!sop) continue;
        if (sop.skipped || menuSopDraftChecks(sop).complete) n += 1;
      }
    }
    return n;
  }, [tree, sopByMenuId]);

  const totalItems = useMemo(
    () => tree.reduce((n, b) => n + b.items.length, 0),
    [tree],
  );

  const showingDetail = !!(selectedItem || selectedBaseId);

  if (!can(staff, "bakerySop")) return null;

  function openMenu(id: string) {
    setSelectedBaseId(null);
    setSelectedMenuId(id);
    setTab("draft");
    setMsg("");
    setErr("");
  }

  function openBase(id: string) {
    setSelectedMenuId(null);
    setSelectedBaseId(id);
    setTab("draft");
    setMsg("");
    setErr("");
  }

  function closeDetail() {
    setSelectedMenuId(null);
    setSelectedBaseId(null);
    setMsg("");
    setErr("");
  }

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onToggleMenuFlag(
    item: MenuItem,
    patch: { skipped?: boolean; staffVisible?: boolean },
  ) {
    if (!canWrite || !actorId || !isOwner) return;
    setBusy(true);
    setErr("");
    try {
      const sop = sopByMenuId.get(item.id);
      await patchMenuSopWorkFlags({
        menuItemId: item.id,
        menuName: item.name,
        sopId: sop?.id,
        updatedBy: actorId,
        ...patch,
      });
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleBaseFlag(
    sop: MenuSop,
    patch: { skipped?: boolean; staffVisible?: boolean },
  ) {
    if (!canWrite || !actorId || !isOwner) return;
    setBusy(true);
    setErr("");
    try {
      await patchMenuSopWorkFlags({
        sopId: sop.id,
        updatedBy: actorId,
        ...patch,
      });
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  /** ถามแล้วดึงสูตรเดิมลงส่วนผสมเท่านั้น — ไม่ดึงจับคู่คลังจากชีต */
  async function onImportLegacyDraft(item: MenuItem) {
    if (!canWrite || !actorId) return;
    const draft = legacySopDraftForName(item.name);
    if (!draft?.ingredientsText) {
      setMsg("รายการนี้ไม่มีสูตรเดิม");
      return;
    }
    if (!confirmPullLegacyDraft(item.name, draft.ingredientsText)) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const prev = sopByMenuId.get(item.id);
      await upsertMenuSopForMenuItem({
        menuItemId: item.id,
        name: item.name,
        existingId: prev?.id,
        description: prev?.description || "",
        ingredientsText: draft.ingredientsText,
        makeStepsText: prev?.makeStepsText || "",
        sellStepsText: prev?.sellStepsText || "",
        yieldQty: prev?.yieldQty,
        yieldUnit: prev?.yieldUnit,
        pieceWeightG: prev?.pieceWeightG,
        updatedBy: actorId,
      });
      setMsg(`ดึงสูตรแล้ว: ${item.name} — เปิดรายการเพื่อตรวจ/จับคู่คลังได้`);
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="module-page bakery-sop-page bakery-sop-page--tree">
      <div className="module-page-head">
        <h1 className="panel-title module-page-title">
          <NotebookPen size={18} aria-hidden />
          SOP
        </h1>
      </div>

      {err ? <p className="error-text bakery-sop-slim-msg">{err}</p> : null}
      {msg ? <p className="ok bakery-sop-slim-msg">{msg}</p> : null}

      {!showingDetail ? (
        <div className="bakery-sop-tree-wrap">
          <div className="check-history-toolbar bakery-sop-toolbar ot-toolbar-slim module-toolbar-slim">
            <p className="muted check-history-stats module-slim-stats">
              เบส {baseFilledCount}/{baseSops.length}
              {" · "}
              เมนู {filledCount}/{totalItems} ครบ
            </p>
          </div>
          {!menuReady ? (
            <p className="empty bakery-sop-slim-empty">กำลังโหลดเมนู…</p>
          ) : (
            <>
              {/* —— ตารางเบส (แยกใบ — คอลัมน์ต่างจากเมนูได้) —— */}
              <section
                className="bakery-sop-list-section bakery-sop-list-section--base"
                aria-labelledby="bakery-sop-base-heading"
              >
                <div className="bakery-sop-list-section-head">
                  <button
                    type="button"
                    className="bakery-sop-group-toggle bakery-sop-section-toggle"
                    onClick={() => setBaseOpen((v) => !v)}
                    aria-expanded={baseOpen}
                    id="bakery-sop-base-heading"
                  >
                    {baseOpen ? (
                      <ChevronDown size={14} aria-hidden />
                    ) : (
                      <ChevronRight size={14} aria-hidden />
                    )}
                    <span>เบส</span>
                  </button>
                  <span className="muted bakery-sop-tree-count">
                    {baseFilledCount}/{baseSops.length}
                  </span>
                  {canWrite ? (
                    <button
                      type="button"
                      className="btn bakery-sop-fit-btn"
                      onClick={() => openBase("__new__")}
                      title="เพิ่มเบส"
                    >
                      +
                    </button>
                  ) : null}
                </div>
                {baseOpen ? (
                  <div className="sheet-wrap bakery-sop-sheet sheet-bleed bakery-sop-sheet--base">
                    <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-sheet-table--base">
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            className="bakery-sop-th-name bakery-sop-th-sticky"
                          >
                            ชื่อเบส
                          </th>
                          <th scope="col" className="bakery-sop-yield-hd">
                            ได้/ครั้ง
                          </th>
                          <th scope="col" className="bakery-sop-mark-hd">
                            ผสม
                          </th>
                          <th scope="col" className="bakery-sop-summary-hd">
                            สถานะ
                          </th>
                          <th scope="col" className="bakery-sop-mark-hd">
                            ข้าม
                          </th>
                          {isOwner ? (
                            <th scope="col" className="bakery-sop-mark-hd">
                              โฟกัส
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {baseSops.length === 0 ? (
                          <tr className="bakery-sop-row-item is-base">
                            <td
                              colSpan={baseTableColCount}
                              className="muted bakery-sop-base-empty"
                            >
                              ยังไม่มีเบส — กด + สร้าง เช่น เบสชาเขียว · เบสชาไทย
                            </td>
                          </tr>
                        ) : (
                          baseSops.map((b) => {
                            const checks = menuSopDraftChecks(b);
                            const summary = menuSopSummaryStatus(
                              b.skipped,
                              checks,
                            );
                            const yieldLabel = `${b.yieldQty || 1} ${b.yieldUnit || ""}`.trim();
                            return (
                              <tr
                                key={`base-${b.id}`}
                                className={
                                  b.skipped
                                    ? "bakery-sop-row-item is-base is-skipped"
                                    : summary === "done"
                                      ? "bakery-sop-row-item is-base is-complete"
                                      : "bakery-sop-row-item is-base"
                                }
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="bakery-sop-base-name-btn"
                                    onClick={() => openBase(b.id)}
                                  >
                                    {b.name}
                                  </button>
                                </td>
                                <td className="bakery-sop-yield-cell">
                                  {yieldLabel}
                                </td>
                                <DraftStatusCells
                                  checks={checks}
                                  skipped={b.skipped}
                                  isBase
                                />
                                <SummaryStatusCell
                                  status={summary}
                                  missingLabels={checks.missingLabels}
                                  isBase
                                />
                                <td className="bakery-sop-mark-cell">
                                  {isOwner ? (
                                    <button
                                      type="button"
                                      className={
                                        b.skipped
                                          ? "bakery-sop-flag-btn is-on"
                                          : "bakery-sop-flag-btn"
                                      }
                                      disabled={busy || !canWrite}
                                      title="ข้าม"
                                      aria-pressed={b.skipped}
                                      onClick={() =>
                                        void onToggleBaseFlag(b, {
                                          skipped: !b.skipped,
                                        })
                                      }
                                    >
                                      {b.skipped ? "✓" : "·"}
                                    </button>
                                  ) : (
                                    <span className="bakery-sop-flag-ro">
                                      {b.skipped ? "✓" : "·"}
                                    </span>
                                  )}
                                </td>
                                {isOwner ? (
                                  <td className="bakery-sop-mark-cell">
                                    <button
                                      type="button"
                                      className={
                                        b.staffVisible
                                          ? "bakery-sop-flag-btn is-vis"
                                          : "bakery-sop-flag-btn"
                                      }
                                      disabled={busy || !canWrite}
                                      title={
                                        b.staffVisible
                                          ? "โฟกัสงานนี้ (กดปิด)"
                                          : "ตั้งโฟกัสงาน"
                                      }
                                      aria-pressed={b.staffVisible}
                                      onClick={() =>
                                        void onToggleBaseFlag(b, {
                                          staffVisible: !b.staffVisible,
                                        })
                                      }
                                    >
                                      {b.staffVisible ? (
                                        <Eye size={12} aria-hidden />
                                      ) : (
                                        <EyeOff size={12} aria-hidden />
                                      )}
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>

              {/* —— ตารางเมนูหลังร้าน (แยกใบจากเบส) —— */}
              <section
                className="bakery-sop-list-section bakery-sop-list-section--menu"
                aria-labelledby="bakery-sop-menu-heading"
              >
                <div className="bakery-sop-list-section-head">
                  <h2
                    id="bakery-sop-menu-heading"
                    className="bakery-sop-section-title"
                  >
                    เมนูหลังร้าน
                  </h2>
                  <span className="muted bakery-sop-tree-count">
                    {filledCount}/{totalItems}
                  </span>
                </div>
                <div className="sheet-wrap bakery-sop-sheet sheet-bleed bakery-sop-sheet--menu">
                  <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-sheet-table--tree">
                    <thead>
                      <tr>
                        <th
                          scope="col"
                          className="bakery-sop-th-name bakery-sop-th-sticky"
                        >
                          ชื่อเมนู
                        </th>
                        <th scope="col" className="bakery-sop-mark-hd">
                          ผสม
                        </th>
                        <th scope="col" className="bakery-sop-summary-hd">
                          สถานะ
                        </th>
                        <th scope="col" className="bakery-sop-mark-hd">
                          ข้าม
                        </th>
                        {isOwner ? (
                          <th scope="col" className="bakery-sop-mark-hd">
                            โฟกัส
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {tree.length === 0 ? (
                        <tr>
                          <td
                            colSpan={menuTableColCount}
                            className="muted bakery-sop-base-empty"
                          >
                            ยังไม่มีหมวดในเมนูหลังร้าน
                          </td>
                        </tr>
                      ) : (
                        tree.map(({ cat, items }) => {
                          const open = expandedCats.has(cat.id);
                          const done = items.filter((it) => {
                            const s = sopByMenuId.get(it.id);
                            if (!s) return false;
                            return (
                              s.skipped || menuSopDraftChecks(s).complete
                            );
                          }).length;
                          return (
                            <Fragment key={cat.id}>
                              <tr className="bakery-sop-row-group">
                                <td>
                                  <button
                                    type="button"
                                    className="bakery-sop-group-toggle"
                                    onClick={() => toggleCat(cat.id)}
                                    aria-expanded={open}
                                  >
                                    {open ? (
                                      <ChevronDown size={14} aria-hidden />
                                    ) : (
                                      <ChevronRight size={14} aria-hidden />
                                    )}
                                    <span>{cat.name}</span>
                                  </button>
                                </td>
                                <GroupMetaCells
                                  done={done}
                                  total={items.length}
                                  isOwner={isOwner}
                                />
                              </tr>
                              {open
                                ? items.length === 0
                                  ? (
                                      <tr className="bakery-sop-row-item">
                                        <td
                                          colSpan={menuTableColCount}
                                          className="muted bakery-sop-base-empty bakery-sop-indent"
                                        >
                                          ไม่มีเมนู
                                        </td>
                                      </tr>
                                    )
                                  : items.map((it) => {
                                      const sop = sopByMenuId.get(it.id);
                                      const checks = menuSopDraftChecks(
                                        sop || null,
                                      );
                                      const skipped = !!sop?.skipped;
                                      const focused = sop
                                        ? sop.staffVisible
                                        : true;
                                      const summary = menuSopSummaryStatus(
                                        skipped,
                                        checks,
                                      );
                                      return (
                                        <tr
                                          key={it.id}
                                          className={
                                            skipped
                                              ? "bakery-sop-row-item is-skipped"
                                              : summary === "done"
                                                ? "bakery-sop-row-item is-complete"
                                                : !focused
                                                  ? "bakery-sop-row-item is-unfocused"
                                                  : "bakery-sop-row-item"
                                          }
                                        >
                                          <td>
                                            <div className="bakery-sop-name-with-act bakery-sop-indent">
                                              <button
                                                type="button"
                                                className="bakery-sop-base-name-btn"
                                                onClick={() => openMenu(it.id)}
                                              >
                                                {it.name}
                                              </button>
                                              {canWrite &&
                                              legacySopDraftForName(it.name)
                                                ?.ingredientsText ? (
                                                <button
                                                  type="button"
                                                  className="btn bakery-sop-fit-btn bakery-sop-legacy-import-btn"
                                                  disabled={busy}
                                                  title="ถามก่อน แล้วดึงสูตรใส่ส่วนผสม"
                                                  onClick={() =>
                                                    void onImportLegacyDraft(it)
                                                  }
                                                >
                                                  ดึงสูตร
                                                </button>
                                              ) : null}
                                            </div>
                                          </td>
                                          <DraftStatusCells
                                            checks={checks}
                                            skipped={skipped}
                                          />
                                          <SummaryStatusCell
                                            status={summary}
                                            missingLabels={checks.missingLabels}
                                          />
                                          <td className="bakery-sop-mark-cell">
                                            {isOwner ? (
                                              <button
                                                type="button"
                                                className={
                                                  skipped
                                                    ? "bakery-sop-flag-btn is-on"
                                                    : "bakery-sop-flag-btn"
                                                }
                                                disabled={busy || !canWrite}
                                                title="ข้าม"
                                                aria-pressed={skipped}
                                                onClick={() =>
                                                  void onToggleMenuFlag(it, {
                                                    skipped: !skipped,
                                                  })
                                                }
                                              >
                                                {skipped ? "✓" : "·"}
                                              </button>
                                            ) : (
                                              <span className="bakery-sop-flag-ro">
                                                {skipped ? "✓" : "·"}
                                              </span>
                                            )}
                                          </td>
                                          {isOwner ? (
                                            <td className="bakery-sop-mark-cell">
                                              <button
                                                type="button"
                                                className={
                                                  focused
                                                    ? "bakery-sop-flag-btn is-vis"
                                                    : "bakery-sop-flag-btn"
                                                }
                                                disabled={busy || !canWrite}
                                                title={
                                                  focused
                                                    ? "โฟกัสงานนี้ (กดปิด)"
                                                    : "ตั้งโฟกัสงาน"
                                                }
                                                aria-pressed={focused}
                                                onClick={() =>
                                                  void onToggleMenuFlag(it, {
                                                    staffVisible: !focused,
                                                  })
                                                }
                                              >
                                                {focused ? (
                                                  <Eye size={12} aria-hidden />
                                                ) : (
                                                  <EyeOff
                                                    size={12}
                                                    aria-hidden
                                                  />
                                                )}
                                              </button>
                                            </td>
                                          ) : null}
                                        </tr>
                                      );
                                    })
                                : null}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      ) : selectedBaseId ? (
        <BaseSopEditor
          sop={selectedBase}
          isNew={selectedBaseId === "__new__"}
          tab={tab}
          setTab={setTab}
          canWrite={canWrite}
          canSeeCost={canSeeCost}
          actorId={actorId || ""}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          setErr={setErr}
          onBack={closeDetail}
          onCreated={(id) => setSelectedBaseId(id)}
          baseSops={baseSops}
        />
      ) : selectedItem ? (
        <MenuSopEditor
          item={selectedItem}
          sop={selectedSop}
          tab={tab}
          setTab={setTab}
          canWrite={canWrite}
          canSeeCost={canSeeCost}
          actorId={actorId || ""}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          setErr={setErr}
          onBack={closeDetail}
          baseSops={baseSops}
        />
      ) : null}
    </div>
  );
}

function BaseSopEditor({
  sop,
  isNew,
  tab,
  setTab,
  canWrite,
  canSeeCost,
  actorId,
  busy,
  setBusy,
  setMsg,
  setErr,
  onBack,
  onCreated,
  baseSops,
}: {
  sop: MenuSop | null;
  isNew: boolean;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  canWrite: boolean;
  canSeeCost: boolean;
  actorId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string) => void;
  setErr: (v: string) => void;
  onBack: () => void;
  onCreated: (id: string) => void;
  /** เบสอื่นในร้าน — ไม่รวมตัวเองในตัวเลือกส่วนผสม */
  baseSops: MenuSop[];
}) {
  const [name, setName] = useState(sop?.name || "");
  const [ingredientsText, setIngredientsText] = useState(
    sop?.ingredientsText || "",
  );
  const [yieldQty, setYieldQty] = useState(String(sop?.yieldQty ?? 1));
  const [yieldUnit, setYieldUnit] = useState(
    normalizeStockUnit(sop?.yieldUnit || "ล.") || "ล.",
  );
  const [pieceWeightG, setPieceWeightG] = useState(
    sop?.pieceWeightG != null ? String(sop.pieceWeightG) : "",
  );

  useEffect(() => {
    setName(sop?.name || "");
    setIngredientsText(sop?.ingredientsText || "");
    setYieldQty(String(sop?.yieldQty ?? 1));
    setYieldUnit(normalizeStockUnit(sop?.yieldUnit || "ล.") || "ล.");
    setPieceWeightG(sop?.pieceWeightG != null ? String(sop.pieceWeightG) : "");
  }, [sop, isNew]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !actorId) return;
    setBusy(true);
    setErr("");
    try {
      const id = await upsertMenuSopBase({
        name,
        description: sop?.description || "",
        ingredientsText,
        makeStepsText: sop?.makeStepsText || "",
        sellStepsText: sop?.sellStepsText || "",
        yieldQty: Number(yieldQty) || 1,
        yieldUnit: normalizeStockUnit(yieldUnit) || "ล.",
        pieceWeightG: pieceWeightG ? Number(pieceWeightG) : undefined,
        existingId: isNew ? undefined : sop?.id,
        staffVisible: true,
        updatedBy: actorId,
      });
      setMsg("บันทึกเบสแล้ว");
      if (isNew) onCreated(id);
    } catch (er) {
      setErr(mapFirestoreError(er));
    } finally {
      setBusy(false);
    }
  }

  const liveSop: MenuSop = sop
    ? {
        ...sop,
        name: name.trim() || sop.name,
        ingredientsText,
        yieldQty: Number(yieldQty) || 1,
        yieldUnit,
        pieceWeightG: pieceWeightG ? Number(pieceWeightG) : undefined,
      }
    : {
        id: "",
        name: name.trim() || "เบส",
        category: "base",
        description: "",
        ingredientsText,
        makeStepsText: "",
        sellStepsText: "",
        yieldQty: Number(yieldQty) || 1,
        yieldUnit,
        pieceWeightG: pieceWeightG ? Number(pieceWeightG) : undefined,
        steps: [],
        ingredients: [],
        skipped: false,
        staffVisible: true,
        active: true,
        createdAt: 0,
        updatedAt: 0,
        updatedBy: "",
      };

  return (
    <div className="bakery-sop-detail bakery-sop-detail--slim">
      <div className="bakery-sop-detail-bar">
        <button
          type="button"
          className="btn ghost bakery-sop-fit-btn"
          aria-label="กลับ"
          onClick={onBack}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <strong className="bakery-sop-edit-title">
          {isNew ? "เบสใหม่" : name.trim() || "เบส"}
        </strong>
        <span className="muted bakery-sop-price-chip">เบส</span>
        {canSeeCost && sop && !isNew ? (
          <div className="bakery-sop-tab-pills" role="tablist">
            <button
              type="button"
              className={tab === "draft" ? "is-active" : ""}
              onClick={() => setTab("draft")}
            >
              ข้อมูล
            </button>
            <button
              type="button"
              className={tab === "cost" ? "is-active" : ""}
              onClick={() => setTab("cost")}
            >
              ต้นทุน
            </button>
          </div>
        ) : null}
        {canWrite && (tab === "draft" || !canSeeCost || !sop || isNew) ? (
          <button
            type="submit"
            form="bakery-sop-base-form"
            className="btn primary bakery-sop-fit-btn"
            disabled={busy}
          >
            บันทึก
          </button>
        ) : null}
      </div>

      {tab === "draft" || !canSeeCost || !sop || isNew ? (
        <form
          id="bakery-sop-base-form"
          className="bakery-sop-form bakery-sop-form--fields form-card entry-form"
          onSubmit={(e) => void onSave(e)}
        >
          <div className="field">
            <label htmlFor="base-name">ชื่อเบส</label>
            <input
              id="base-name"
              value={name}
              disabled={!canWrite}
              placeholder="เช่น เบสชาเขียว · เบสชาไทย · เบสชามะลิ"
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="stock-form-grid bakery-sop-meta-grid">
            <div className="field">
              <label htmlFor="base-yield">ได้ต่อครั้ง</label>
              <input
                id="base-yield"
                type="number"
                min={1}
                step={1}
                value={yieldQty}
                disabled={!canWrite}
                onChange={(e) => setYieldQty(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="base-unit">หน่วย</label>
              <select
                id="base-unit"
                value={
                  STOCK_UNIT_OPTIONS.some((u) => u.value === yieldUnit)
                    ? yieldUnit
                    : normalizeStockUnit(yieldUnit) || "ล."
                }
                disabled={!canWrite}
                onChange={(e) =>
                  setYieldUnit(normalizeStockUnit(e.target.value) || "ล.")
                }
              >
                {STOCK_UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
                {yieldUnit &&
                !STOCK_UNIT_OPTIONS.some((u) => u.value === yieldUnit) ? (
                  <option value={yieldUnit}>{yieldUnit}</option>
                ) : null}
              </select>
            </div>
            <div className="field">
              <label htmlFor="base-grams">ก./หน่วย</label>
              <input
                id="base-grams"
                type="number"
                min={0}
                step={1}
                value={pieceWeightG}
                disabled={!canWrite}
                placeholder="—"
                onChange={(e) => setPieceWeightG(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <div className="bakery-sop-field-head">
              <label htmlFor="base-ing">ส่วนผสม</label>
              <LegacyDraftImportButton
                menuName={name.trim() || sop?.name || ""}
                canWrite={canWrite}
                disabled={busy || (isNew && !name.trim())}
                onApply={(draft) => {
                  setIngredientsText(draft.ingredientsText);
                  setMsg(
                    `ดึงสูตรแล้ว — ตรวจส่วนผสมแล้วกดบันทึก หรือแก้เองได้`,
                  );
                }}
              />
            </div>
            <IngredientAiBlock
              sopId={sop?.id || null}
              ensureSopId={
                canWrite && actorId
                  ? async () => {
                      const trimmed = name.trim();
                      if (!trimmed) {
                        throw new Error("ใส่ชื่อเบสก่อน แล้วค่อยใส่ตาราง");
                      }
                      const id = await upsertMenuSopBase({
                        name: trimmed,
                        description: sop?.description || "",
                        ingredientsText,
                        makeStepsText: sop?.makeStepsText || "",
                        sellStepsText: sop?.sellStepsText || "",
                        yieldQty: Number(yieldQty) || 1,
                        yieldUnit: normalizeStockUnit(yieldUnit) || "ล.",
                        pieceWeightG: pieceWeightG
                          ? Number(pieceWeightG)
                          : undefined,
                        existingId: isNew ? undefined : sop?.id,
                        staffVisible: true,
                        updatedBy: actorId,
                      });
                      if (isNew) onCreated(id);
                      return id;
                    }
                  : undefined
              }
              name={name.trim() || sop?.name || "เบส"}
              yieldQty={Number(yieldQty) || 1}
              yieldUnit={yieldUnit}
              pieceWeightG={pieceWeightG ? Number(pieceWeightG) : undefined}
              ingredientsText={ingredientsText}
              setIngredientsText={setIngredientsText}
              ingredients={sop?.ingredients || []}
              makeStepsText={sop?.makeStepsText || ""}
              actorId={actorId}
              canWrite={canWrite}
              busy={busy}
              setBusy={setBusy}
              setMsg={setMsg}
              setErr={setErr}
              baseSops={baseSops.filter((b) => b.id !== sop?.id)}
              textareaId="base-ing"
            />
          </div>
        </form>
      ) : (
        <OwnerCostTab
          sop={liveSop}
          actorId={actorId}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          setErr={setErr}
          baseSops={baseSops.filter((b) => b.id !== sop?.id)}
        />
      )}
    </div>
  );
}

function MenuSopEditor({
  item,
  sop,
  tab,
  setTab,
  canWrite,
  canSeeCost,
  actorId,
  busy,
  setBusy,
  setMsg,
  setErr,
  onBack,
  baseSops,
}: {
  item: MenuItem;
  sop: MenuSop | null;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  canWrite: boolean;
  canSeeCost: boolean;
  actorId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string) => void;
  setErr: (v: string) => void;
  onBack: () => void;
  baseSops: MenuSop[];
}) {
  const [ingredientsText, setIngredientsText] = useState(
    sop?.ingredientsText || "",
  );
  /** เมนู = 1 แก้วต่อสูตร — ไม่มีช่องได้ / ก.ต่อแก้ว */
  const menuYieldQty = 1;
  const menuYieldUnit = sop?.yieldUnit || "แก้ว";

  useEffect(() => {
    setIngredientsText(sop?.ingredientsText || "");
  }, [sop, item.id]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !actorId) return;
    setBusy(true);
    setErr("");
    try {
      await upsertMenuSopForMenuItem({
        menuItemId: item.id,
        name: item.name,
        description: sop?.description || "",
        ingredientsText,
        makeStepsText: sop?.makeStepsText || "",
        sellStepsText: sop?.sellStepsText || "",
        yieldQty: menuYieldQty,
        yieldUnit: menuYieldUnit,
        existingId: sop?.id,
        updatedBy: actorId,
      });
      setMsg("บันทึกแล้ว");
    } catch (er) {
      setErr(mapFirestoreError(er));
    } finally {
      setBusy(false);
    }
  }

  const liveSop: MenuSop = sop
    ? {
        ...sop,
        name: item.name,
        ingredientsText,
        yieldQty: menuYieldQty,
        yieldUnit: menuYieldUnit,
      }
    : {
        id: "",
        name: item.name,
        category: "menu",
        menuItemId: item.id,
        description: "",
        ingredientsText,
        makeStepsText: "",
        sellStepsText: "",
        yieldQty: menuYieldQty,
        yieldUnit: menuYieldUnit,
        steps: [],
        ingredients: [],
        skipped: false,
        staffVisible: false,
        active: true,
        createdAt: 0,
        updatedAt: 0,
        updatedBy: "",
      };

  return (
    <div className="bakery-sop-detail bakery-sop-detail--slim">
      <div className="bakery-sop-detail-bar">
        <button
          type="button"
          className="btn ghost bakery-sop-fit-btn"
          aria-label="กลับ"
          onClick={onBack}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <strong className="bakery-sop-edit-title">{item.name}</strong>
        <span className="muted bakery-sop-price-chip">
          ฿{formatPlainNumber(item.price)}
        </span>
        {canSeeCost && sop ? (
          <div className="bakery-sop-tab-pills" role="tablist">
            <button
              type="button"
              className={tab === "draft" ? "is-active" : ""}
              onClick={() => setTab("draft")}
            >
              ข้อมูล
            </button>
            <button
              type="button"
              className={tab === "cost" ? "is-active" : ""}
              onClick={() => setTab("cost")}
            >
              ต้นทุน
            </button>
          </div>
        ) : null}
        {canWrite && (tab === "draft" || !canSeeCost || !sop) ? (
          <button
            type="submit"
            form="bakery-sop-draft-form"
            className="btn primary bakery-sop-fit-btn"
            disabled={busy}
          >
            บันทึก
          </button>
        ) : null}
      </div>

      {tab === "draft" || !canSeeCost || !sop ? (
        <form
          id="bakery-sop-draft-form"
          className="bakery-sop-form bakery-sop-form--fields form-card entry-form"
          onSubmit={(e) => void onSave(e)}
        >
          <div className="field">
            <div className="bakery-sop-field-head">
              <label htmlFor="sop-ing">ส่วนผสม</label>
              <LegacyDraftImportButton
                menuName={item.name}
                canWrite={canWrite}
                disabled={busy}
                onApply={(draft) => {
                  setIngredientsText(draft.ingredientsText);
                  setMsg(
                    `ดึงสูตรแล้ว — ตรวจส่วนผสมแล้วกดบันทึก หรือแก้เองได้`,
                  );
                }}
              />
            </div>
            <IngredientAiBlock
              sopId={sop?.id || null}
              ensureSopId={
                canWrite && actorId
                  ? async () =>
                      upsertMenuSopForMenuItem({
                        menuItemId: item.id,
                        name: item.name,
                        description: sop?.description || "",
                        ingredientsText,
                        makeStepsText: sop?.makeStepsText || "",
                        sellStepsText: sop?.sellStepsText || "",
                        yieldQty: menuYieldQty,
                        yieldUnit: menuYieldUnit,
                        existingId: sop?.id,
                        updatedBy: actorId,
                      })
                  : undefined
              }
              name={item.name}
              yieldQty={menuYieldQty}
              yieldUnit={menuYieldUnit}
              ingredientsText={ingredientsText}
              setIngredientsText={setIngredientsText}
              ingredients={sop?.ingredients || []}
              makeStepsText={sop?.makeStepsText || ""}
              actorId={actorId}
              canWrite={canWrite}
              busy={busy}
              setBusy={setBusy}
              setMsg={setMsg}
              setErr={setErr}
              baseSops={baseSops}
            />
          </div>
        </form>
      ) : (
        <OwnerCostTab
          sop={liveSop}
          actorId={actorId}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          setErr={setErr}
          baseSops={baseSops}
        />
      )}
    </div>
  );
}

function OwnerCostTab({
  sop,
  actorId,
  busy,
  setBusy,
  setMsg,
  setErr,
  baseSops,
}: {
  sop: MenuSop;
  actorId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string) => void;
  setErr: (v: string) => void;
  baseSops: MenuSop[];
}) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [links, setLinks] = useState<MenuSopIngredientLink[]>([]);
  const [sellPrice, setSellPrice] = useState<number | null>(null);
  const [billProposals, setBillProposals] = useState<BillCostLineProposal[]>([]);
  const [ledgerPick, setLedgerPick] = useState<LedgerEntry[]>([]);
  const [billLedgerId, setBillLedgerId] = useState<string | null>(null);
  const [pendingBillLine, setPendingBillLine] = useState<BillCostLineProposal | null>(
    null,
  );

  useEffect(() => {
    return subscribeStockItemsWithCosts(setStock, (e) =>
      setErr(mapFirestoreError(e)),
    );
  }, [setErr]);

  useEffect(() => {
    if (!sop.id) return;
    return subscribeMenuSopCost(
      sop.id,
      (docRow) => setLinks(docRow?.ingredientLinks || []),
      (e) => setErr(mapFirestoreError(e)),
    );
  }, [sop.id, setErr]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sop.menuItemId) {
        setSellPrice(null);
        return;
      }
      try {
        const snap = await getDoc(doc(getDb(), "menuItems", sop.menuItemId));
        if (cancelled) return;
        if (snap.exists()) {
          const p = Number(snap.data()?.price);
          setSellPrice(Number.isFinite(p) ? p : null);
        }
      } catch {
        if (!cancelled) setSellPrice(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sop.menuItemId]);

  const stockById = useMemo(() => {
    const m = new Map<string, { name: string; unit: string }>();
    for (const s of stock) m.set(s.id, { name: s.name, unit: s.unit });
    return m;
  }, [stock]);

  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) m.set(s.id, s.unitCost || 0);
    return m;
  }, [stock]);

  const summary = useMemo(
    () => computeMenuSopCostSummary(sop, links, stockById, costMap),
    [sop, links, stockById, costMap],
  );

  function linkFor(ingId: string): MenuSopIngredientLink | undefined {
    return links.find((l) => l.ingredientId === ingId);
  }

  function linkSelectValue(link: MenuSopIngredientLink | undefined): string {
    if (!link) return "";
    if (link.baseSopId) return encodeMenuSopBaseRef(link.baseSopId);
    return link.stockItemId || "";
  }

  function patchLink(ingId: string, patch: Partial<MenuSopIngredientLink>) {
    const ing = sop.ingredients.find((i) => i.id === ingId);
    const prev = linkFor(ingId);
    const next: MenuSopIngredientLink = {
      ingredientId: ingId,
      stockItemId: patch.stockItemId ?? prev?.stockItemId ?? "",
      baseSopId:
        patch.baseSopId !== undefined
          ? patch.baseSopId || undefined
          : prev?.baseSopId,
      qty: patch.qty ?? prev?.qty ?? ing?.qty ?? 0,
      unit: patch.unit ?? prev?.unit ?? ing?.unit ?? "ก.",
    };
    if (next.stockItemId) next.baseSopId = undefined;
    if (next.baseSopId) next.stockItemId = "";
    const rest = links.filter((l) => l.ingredientId !== ingId);
    setLinks(ingredientLinkHasPair(next) ? [...rest, next] : rest);
  }

  function pickIngredientRef(ingId: string, raw: string) {
    const ing = sop.ingredients.find((i) => i.id === ingId);
    const ref = parseMenuSopIngredientRef(raw);
    if (ref.kind === "base") {
      const base = baseSops.find((b) => b.id === ref.id);
      patchLink(ingId, {
        stockItemId: "",
        baseSopId: base?.id || "",
        unit: ing?.unit || base?.yieldUnit || "ก.",
      });
      return;
    }
    if (ref.kind === "stock") {
      const hit = stock.find((s) => s.id === ref.id);
      patchLink(ingId, {
        stockItemId: hit?.id || "",
        baseSopId: "",
        unit: ing?.unit || hit?.unit || "ก.",
      });
      return;
    }
    patchLink(ingId, { stockItemId: "", baseSopId: "" });
  }

  async function saveLinks() {
    if (!sop.id) return;
    setBusy(true);
    setErr("");
    try {
      await setMenuSopIngredientLinks(
        sop.id,
        links.filter((l) => ingredientLinkHasPair(l)),
        actorId,
      );
      setMsg("บันทึกลิงก์ต้นทุนแล้ว");
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runAiMap() {
    if (!sop.id) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const result = await analyzeMenuSopCost({
        sop: {
          name: sop.name,
          yieldQty: sop.yieldQty,
          yieldUnit: sop.yieldUnit,
          pieceWeightG: sop.pieceWeightG,
          ingredientsText: sop.ingredientsText,
          steps: sop.steps.map((s) => ({ title: s.title, body: s.body })),
          ingredients: sop.ingredients,
        },
        stockCatalog: [
          ...baseSops.map((b) => ({
            id: encodeMenuSopBaseRef(b.id),
            name: b.name,
            unit: b.yieldUnit || "ลิตร",
            unitCost: 0,
            aliases: ["เบส", `เบส${b.name}`],
          })),
          ...stock.map((s) => ({
            id: s.id,
            name: s.name,
            unit: s.unit,
            unitCost: s.unitCost || 0,
            aliases: s.aliases || [],
          })),
        ],
      });
      const next: MenuSopIngredientLink[] = [];
      for (const p of result.links) {
        if (!p.ingredientId) continue;
        const ref = parseMenuSopIngredientRef(p.stockItemId || "");
        if (ref.kind === "base") {
          const base = baseSops.find((b) => b.id === ref.id);
          if (!base) continue;
          next.push({
            ingredientId: p.ingredientId,
            stockItemId: "",
            baseSopId: base.id,
            qty: p.qty,
            unit: p.unit || base.yieldUnit || "ก.",
          });
          continue;
        }
        if (!p.stockItemId) continue;
        next.push({
          ingredientId: p.ingredientId,
          stockItemId: p.stockItemId,
          qty: p.qty,
          unit: p.unit,
        });
      }
      if (next.length) setLinks(next);
      setMsg(
        `AI เสนอ ${next.length} ลิงก์ · ≈ ${formatPlainNumber(result.perPieceEstimate ?? 0)}฿/ชิ้น`,
      );
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadLedgerCandidates() {
    setBusy(true);
    setErr("");
    try {
      const entries = await listRecentLedgerEntries(80);
      const withPhotos = entries.filter(
        (e) =>
          e.amountOut > 0 &&
          (e.type === "cogs" ||
            /ท็อป|แม็คโคร|แป้ง|น้ำตาล|ยีส|เบเกอ/i.test(e.description)) &&
          getLedgerReceiptUrls(e).some((u) => u.startsWith("evp:")),
      );
      setLedgerPick(withPhotos.slice(0, 20));
      setMsg(`พบบิลที่มีรูป ${withPhotos.length} รายการ`);
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runAiBill(entry: LedgerEntry) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const refs = getLedgerReceiptUrls(entry).filter((u) =>
        u.startsWith("evp:"),
      );
      const result = await extractStockCostsFromBill({
        imageRefs: refs,
        stockCatalog: stock.map((s) => ({
          id: s.id,
          name: s.name,
          unit: s.unit,
          aliases: s.aliases || [],
        })),
      });
      // client-side alias fallback
      const lines = result.lines.map((line) => {
        if (line.matchStockItemId) return line;
        const hit = findStockByNameOrAlias(stock, line.name);
        if (!hit) return line;
        return {
          ...line,
          matchStockItemId: hit.id,
          matchStockName: hit.name,
          confidence: Math.max(line.confidence, 0.55),
        };
      });
      setBillLedgerId(entry.id);
      setBillProposals(lines);
      try {
        const { updateLedgerEntry } = await import("@/lib/ledger");
        const { billLinesFromAiProposals } = await import("@/lib/ledger-bill-lines");
        await updateLedgerEntry(entry.id, {
          billLines: billLinesFromAiProposals(lines),
        });
      } catch {
        /* เก็บในบิลไม่บังคับถ้า rules/ออฟไลน์ */
      }
      setMsg(`AI อ่านได้ ${lines.length} บรรทัด · บิล ${entry.description.slice(0, 24)}`);
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmApplyBillLine(line: BillCostLineProposal) {
    if (!line.matchStockItemId || !(line.unitCost && line.unitCost > 0)) {
      setErr("ต้องมีคู่คลังและ unitCost");
      return;
    }
    const stockItem = stock.find((s) => s.id === line.matchStockItemId);
    let unitCost = line.unitCost;
    if (stockItem && line.baseUnit) {
      if (!stockUnitsCompatible(line.baseUnit, stockItem.unit)) {
        setErr(
          `หน่วยไม่เข้ากัน: บิล ${line.baseUnit} · คลัง ${stockItem.unit}`,
        );
        return;
      }
      const converted = convertUnitCost(
        line.unitCost,
        line.baseUnit,
        stockItem.unit,
      );
      if (converted != null) unitCost = converted;
    }
    setBusy(true);
    setErr("");
    try {
      await setStockUnitCost(line.matchStockItemId, unitCost, {
        updatedBy: actorId,
        ledgerEntryId: billLedgerId,
        billLineName: line.name,
        baseUnit: stockItem?.unit || line.baseUnit,
        note: line.note || undefined,
      });
      if (line.name) {
        await addStockAliasIfNew(line.matchStockItemId, line.name, actorId);
      }
      setPendingBillLine(null);
      setMsg(
        `อัปเดต ${line.matchStockName || line.name} = ${unitCost}฿/${stockItem?.unit || line.baseUnit}`,
      );
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyBillLine(line: BillCostLineProposal) {
    if (!line.matchStockItemId || !(line.unitCost && line.unitCost > 0)) {
      setErr("ต้องมีคู่คลังและ unitCost");
      return;
    }
    if (line.confidence > 0 && line.confidence < 0.7) {
      setMsg(`ความมั่นใจต่ำ (${Math.round(line.confidence * 100)}%) — ตรวจก่อนยืนยัน`);
    }
    setPendingBillLine(line);
  }

  const margin =
    sellPrice != null && summary.perPiece > 0
      ? Math.round((sellPrice - summary.perPiece) * 100) / 100
      : null;

  if (!sop.id) {
    return (
      <p className="muted bakery-sop-slim-msg">
        บันทึกข้อมูลก่อน แล้วค่อยเปิดแท็บต้นทุน
      </p>
    );
  }

  return (
    <div className="bakery-sop-cost bakery-sop-cost--sheet">
      <div className="sheet-wrap bakery-sop-sheet sheet-bleed">
        <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-cost-sum-table">
          <thead>
            <tr>
              <th>สูตร</th>
              <th>/ชิ้น</th>
              <th>ขาย</th>
              <th>เหลือ</th>
              <th className="bakery-sop-cost-act-hd" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="bakery-sop-num">
                {formatPlainNumber(summary.batchCost)}฿
              </td>
              <td className="bakery-sop-num">
                {formatPlainNumber(summary.perPiece)}฿
              </td>
              <td className="bakery-sop-num">
                {sellPrice != null ? `${formatPlainNumber(sellPrice)}฿` : "—"}
              </td>
              <td className="bakery-sop-num">
                {margin != null ? `${formatPlainNumber(margin)}฿` : "—"}
              </td>
              <td className="bakery-sop-cost-act-cell">
                <button
                  type="button"
                  className="btn primary bakery-sop-fit-btn"
                  disabled={busy || sop.ingredients.length === 0}
                  onClick={() => void saveLinks()}
                >
                  บันทึก
                </button>
                <button
                  type="button"
                  className="btn bakery-sop-fit-btn"
                  disabled={busy || sop.ingredients.length === 0}
                  onClick={() => void runAiMap()}
                  title="AI จับคู่คลัง"
                >
                  <Sparkles size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn bakery-sop-fit-btn"
                  disabled={busy}
                  onClick={() => void loadLedgerCandidates()}
                >
                  บิล
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sheet-wrap bakery-sop-sheet sheet-bleed bakery-sop-cost-lines-wrap">
        <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-cost-lines-table">
          <thead>
            <tr>
              <th>ส่วนผสม</th>
              <th>ปริมาณ</th>
              <th>คลัง</th>
              <th>฿/หน่วย</th>
              <th>ต้นทุน</th>
            </tr>
          </thead>
          <tbody>
            {sop.ingredients.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted bakery-sop-cost-empty">
                  ยังไม่มีรายการส่วนผสม · ใส่ข้อความในแท็บข้อมูลก่อน
                  แล้วให้ AI จัดเป็นบรรทัด
                </td>
              </tr>
            ) : (
              sop.ingredients.map((ing) => {
                const link = linkFor(ing.id);
                const isBaseLink = !!(link?.baseSopId && !link.stockItemId);
                const unitCost = link && !isBaseLink
                  ? costMap.get(link.stockItemId) || 0
                  : 0;
                const qty = link?.qty ?? ing.qty;
                const lineCost = Math.round(qty * unitCost * 100) / 100;
                return (
                  <tr key={ing.id}>
                    <td className="bakery-sop-cost-name">
                      {ing.nameFreeText || "—"}
                    </td>
                    <td className="bakery-sop-cost-qty-cell">
                      <input
                        className="bakery-sop-cost-qty"
                        type="number"
                        min={0}
                        step="any"
                        value={qty || ""}
                        onChange={(e) =>
                          patchLink(ing.id, {
                            qty: Number(e.target.value) || 0,
                          })
                        }
                      />
                      <span className="muted bakery-sop-cost-unit">
                        {link?.unit || ing.unit}
                      </span>
                    </td>
                    <td>
                      <StockBasePickField
                        value={linkSelectValue(link)}
                        displayLabel={
                          isBaseLink
                            ? baseSops.find((b) => b.id === link?.baseSopId)
                                ?.name || "เบส"
                            : stockById.get(link?.stockItemId || "")?.name || ""
                        }
                        baseSops={baseSops}
                        stock={stock}
                        disabled={busy}
                        ariaLabel={`คู่คลัง/เบส ${ing.nameFreeText || ""}`}
                        onPick={(raw) => pickIngredientRef(ing.id, raw)}
                      />
                    </td>
                    <td className="bakery-sop-num">
                      {isBaseLink
                        ? "เบส"
                        : unitCost > 0
                          ? formatPlainNumber(unitCost)
                          : "—"}
                    </td>
                    <td className="bakery-sop-num">
                      {isBaseLink
                        ? "—"
                        : unitCost > 0
                          ? formatPlainNumber(lineCost)
                          : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {ledgerPick.length > 0 ? (
        <div className="sheet-wrap bakery-sop-sheet sheet-bleed">
          <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-cost-bill-table">
            <thead>
              <tr>
                <th>บิล (มีรูป)</th>
                <th className="bakery-sop-cost-act-hd" />
              </tr>
            </thead>
            <tbody>
              {ledgerPick.map((e) => (
                <tr key={e.id}>
                  <td className="bakery-sop-cost-bill-desc">
                    {e.description.slice(0, 48)}
                    {e.description.length > 48 ? "…" : ""}
                  </td>
                  <td className="bakery-sop-cost-act-cell">
                    <button
                      type="button"
                      className="btn bakery-sop-fit-btn"
                      disabled={busy}
                      onClick={() => void runAiBill(e)}
                    >
                      AI อ่าน
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {billProposals.length > 0 ? (
        <div className="sheet-wrap bakery-sop-sheet sheet-bleed">
          <table className="sheet-table sheet-table--dense bakery-sop-sheet-table bakery-sop-cost-bill-table">
            <thead>
              <tr>
                <th>จากบิล</th>
                <th>คู่คลัง</th>
                <th>฿/หน่วย</th>
                <th className="bakery-sop-cost-act-hd" />
              </tr>
            </thead>
            <tbody>
              {billProposals.map((line, i) => (
                <tr key={`${line.name}-${i}`}>
                  <td>{line.name}</td>
                  <td>{line.matchStockName || "—"}</td>
                  <td className="bakery-sop-num">
                    {line.unitCost != null
                      ? `${formatPlainNumber(line.unitCost)}/${line.baseUnit}`
                      : "—"}
                  </td>
                  <td className="bakery-sop-cost-act-cell">
                    <button
                      type="button"
                      className="btn bakery-sop-fit-btn"
                      disabled={
                        busy ||
                        !line.matchStockItemId ||
                        !(line.unitCost && line.unitCost > 0)
                      }
                      onClick={() => void applyBillLine(line)}
                    >
                      อัปเดต
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pendingBillLine ? (
        <div className="sheet-wrap bakery-sop-sheet sheet-bleed bakery-sop-bill-confirm">
          <table className="sheet-table sheet-table--dense bakery-sop-sheet-table">
            <thead>
              <tr>
                <th>ยืนยันอัปเดตราคา</th>
                <th>เก่า</th>
                <th>ใหม่</th>
                <th className="bakery-sop-cost-act-hd" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {pendingBillLine.matchStockName || pendingBillLine.name}
                  {pendingBillLine.confidence > 0 &&
                  pendingBillLine.confidence < 0.7 ? (
                    <span className="bakery-sop-skip-pill"> มั่นใจต่ำ</span>
                  ) : null}
                </td>
                <td className="bakery-sop-num">
                  {formatPlainNumber(
                    costMap.get(pendingBillLine.matchStockItemId || "") || 0,
                  )}
                </td>
                <td className="bakery-sop-num">
                  {formatPlainNumber(pendingBillLine.unitCost || 0)}/
                  {pendingBillLine.baseUnit}
                </td>
                <td className="bakery-sop-cost-act-cell">
                  <button
                    type="button"
                    className="btn bakery-sop-fit-btn"
                    disabled={busy}
                    onClick={() => setPendingBillLine(null)}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    className="btn primary bakery-sop-fit-btn"
                    disabled={busy}
                    onClick={() => void confirmApplyBillLine(pendingBillLine)}
                  >
                    ยืนยัน
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** ป๊อปอัปค้นหาคลัง/เบส — คอมแพค สลิม โฟกัสช่องค้นหา */
function StockBasePickField({
  value,
  displayLabel,
  baseSops,
  stock,
  disabled,
  ariaLabel,
  onPick,
}: {
  value: string;
  displayLabel: string;
  baseSops: MenuSop[];
  stock: StockItem[];
  disabled?: boolean;
  ariaLabel: string;
  onPick: (raw: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const query = q.trim().toLocaleLowerCase("th");
  const matchedBases = useMemo(() => {
    if (!query) return baseSops;
    return baseSops.filter((b) =>
      b.name.toLocaleLowerCase("th").includes(query),
    );
  }, [baseSops, query]);

  const matchedStock = useMemo(() => {
    if (!query) return stock;
    return stock.filter((s) => {
      const name = s.name.toLocaleLowerCase("th");
      if (name.includes(query)) return true;
      return (s.aliases || []).some((a) =>
        a.toLocaleLowerCase("th").includes(query),
      );
    });
  }, [stock, query]);

  function choose(raw: string) {
    onPick(raw);
    setOpen(false);
  }

  const paired = !!value;
  const btnLabel = paired ? displayLabel || "คู่แล้ว" : "ค้นหาคลัง/เบส";

  return (
    <>
      <button
        type="button"
        className={
          paired
            ? "bakery-sop-pick-trigger is-paired"
            : "bakery-sop-pick-trigger"
        }
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Search size={11} aria-hidden />
        <span className="bakery-sop-pick-trigger-label">{btnLabel}</span>
      </button>
      {open ? (
        <div
          className="modal-backdrop edit-modal bakery-sop-pick-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal-card bakery-sop-pick-card"
            role="dialog"
            aria-modal="true"
            aria-label="ค้นหาคลังหรือเบส"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bakery-sop-pick-head">
              <strong>ค้นหาคลัง/เบส</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="ปิด"
                onClick={() => setOpen(false)}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <div className="bakery-sop-pick-search">
              <Search size={12} aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={q}
                placeholder="พิมพ์ชื่อ…"
                aria-label="ค้นหาส่วนผสม"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="bakery-sop-pick-list" role="listbox">
              <button
                type="button"
                className={
                  !value
                    ? "bakery-sop-pick-row is-clear is-active"
                    : "bakery-sop-pick-row is-clear"
                }
                role="option"
                aria-selected={!value}
                onClick={() => choose("")}
              >
                ยังไม่คู่
              </button>
              {matchedBases.length > 0 ? (
                <>
                  <div className="bakery-sop-pick-group">เบส</div>
                  {matchedBases.map((b) => {
                    const v = encodeMenuSopBaseRef(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={
                          value === v
                            ? "bakery-sop-pick-row is-base is-active"
                            : "bakery-sop-pick-row is-base"
                        }
                        role="option"
                        aria-selected={value === v}
                        onClick={() => choose(v)}
                      >
                        <span>{b.name}</span>
                        <span className="muted bakery-sop-pick-meta">
                          {b.yieldQty || 1} {b.yieldUnit || "ล."}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : null}
              {matchedStock.length > 0 ? (
                <>
                  <div className="bakery-sop-pick-group">คลัง</div>
                  {matchedStock.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={
                        value === s.id
                          ? "bakery-sop-pick-row is-active"
                          : "bakery-sop-pick-row"
                      }
                      role="option"
                      aria-selected={value === s.id}
                      onClick={() => choose(s.id)}
                    >
                      <span>{s.name}</span>
                      <span className="muted bakery-sop-pick-meta">
                        {s.unit}
                      </span>
                    </button>
                  ))}
                </>
              ) : null}
              {matchedBases.length === 0 && matchedStock.length === 0 ? (
                <p className="muted bakery-sop-pick-empty">ไม่พบรายการ</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function newIngredientId() {
  return `ing_${Math.random().toString(36).slice(2, 10)}`;
}

function qtyLooksValid(qty: number): boolean {
  return Number.isFinite(qty) && qty > 0;
}

function IngredientAiBlock({
  sopId,
  ensureSopId,
  name,
  yieldQty,
  yieldUnit,
  pieceWeightG,
  ingredientsText,
  setIngredientsText,
  ingredients: initialIngredients,
  makeStepsText,
  actorId,
  canWrite,
  busy,
  setBusy,
  setMsg,
  setErr,
  baseSops,
  textareaId = "sop-ing",
}: {
  /** null = ยังไม่มีเอกสารสูตร — สร้างตอนบันทึกตาราง/ตกลง AI */
  sopId: string | null;
  ensureSopId?: () => Promise<string>;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  pieceWeightG?: number;
  ingredientsText: string;
  setIngredientsText: (v: string) => void;
  ingredients: MenuSopIngredient[];
  makeStepsText: string;
  actorId: string;
  canWrite: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string) => void;
  setErr: (v: string) => void;
  baseSops: MenuSop[];
  /** ให้ตรง htmlFor ของฟอร์มเมนู/เบส */
  textareaId?: string;
}) {
  const [resolvedSopId, setResolvedSopId] = useState<string | null>(sopId);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [rows, setRows] = useState<MenuSopIngredient[]>(initialIngredients);
  const [links, setLinks] = useState<MenuSopIngredientLink[]>([]);
  /** AI เสนอแล้ว ยังไม่บันทึก — รอพนักงานกดตกลงหรือแก้แถว */
  const [aiPending, setAiPending] = useState(false);
  const [savedSnap, setSavedSnap] = useState<{
    rows: MenuSopIngredient[];
    links: MenuSopIngredientLink[];
  } | null>(null);

  useEffect(() => {
    setResolvedSopId(sopId);
  }, [sopId]);

  useEffect(() => {
    if (!aiPending) setRows(initialIngredients);
  }, [initialIngredients, sopId, aiPending]);

  useEffect(() => {
    return subscribeStockItems(setStock, () => undefined);
  }, []);

  useEffect(() => {
    if (!resolvedSopId) {
      if (!aiPending) setLinks([]);
      return;
    }
    return subscribeMenuSopCost(
      resolvedSopId,
      (docRow) => {
        if (!aiPending) setLinks(docRow?.ingredientLinks || []);
      },
      () => undefined,
    );
  }, [resolvedSopId, aiPending]);

  function linkFor(ingId: string) {
    return links.find((l) => l.ingredientId === ingId);
  }

  function linkSelectValue(link: MenuSopIngredientLink | undefined): string {
    if (!link) return "";
    if (link.baseSopId) return encodeMenuSopBaseRef(link.baseSopId);
    return link.stockItemId || "";
  }

  function displayPairName(link: MenuSopIngredientLink | undefined): string {
    if (!link) return "—";
    if (link.baseSopId) {
      return baseSops.find((b) => b.id === link.baseSopId)?.name || "เบส";
    }
    return stock.find((s) => s.id === link.stockItemId)?.name || "—";
  }

  async function resolveSopId(): Promise<string> {
    if (resolvedSopId) return resolvedSopId;
    if (!ensureSopId) {
      throw new Error("ยังไม่มีสูตร — บันทึกส่วนผสมบรรยายก่อน หรือรอสิทธิ์เขียน");
    }
    const id = await ensureSopId();
    setResolvedSopId(id);
    return id;
  }

  async function persistLinks(next: MenuSopIngredientLink[]) {
    if (!canWrite || !actorId) return;
    const id = await resolveSopId();
    await setMenuSopIngredientLinks(
      id,
      next.filter((l) => ingredientLinkHasPair(l)),
      actorId,
    );
  }

  async function persistIngredients(nextIng: MenuSopIngredient[]) {
    if (!canWrite || !actorId) return;
    const id = await resolveSopId();
    await updateMenuSop(id, {
      ingredients: nextIng,
      ingredientsText,
      updatedBy: actorId,
    });
  }

  async function pickStock(ingId: string, raw: string) {
    const ing = rows.find((r) => r.id === ingId);
    const rest = links.filter((l) => l.ingredientId !== ingId);
    const ref = parseMenuSopIngredientRef(raw);
    let next: MenuSopIngredientLink[] = rest;
    if (ref.kind === "base") {
      const base = baseSops.find((b) => b.id === ref.id);
      if (base) {
        next = [
          ...rest,
          {
            ingredientId: ingId,
            stockItemId: "",
            baseSopId: base.id,
            qty: ing?.qty || 0,
            unit: ing?.unit || base.yieldUnit || "ก.",
          },
        ];
      }
    } else if (ref.kind === "stock") {
      const hit = stock.find((s) => s.id === ref.id);
      if (hit) {
        next = [
          ...rest,
          {
            ingredientId: ingId,
            stockItemId: hit.id,
            qty: ing?.qty || 0,
            unit: ing?.unit || normalizeStockUnit(hit.unit) || "ก.",
          },
        ];
      }
    }
    setLinks(next);
    setErr("");
    if (aiPending) return; // ยังไม่บันทึกจนกดตกลง
    try {
      await persistLinks(next);
    } catch (e) {
      setErr(mapFirestoreError(e));
    }
  }

  function findBaseByName(raw: string): MenuSop | undefined {
    const n = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/^เบส\s*/u, "");
    if (!n) return undefined;
    return baseSops.find((b) => {
      const bn = b.name.trim().toLowerCase().replace(/^เบส\s*/u, "");
      return (
        bn === n ||
        b.name.trim().toLowerCase() === String(raw).trim().toLowerCase()
      );
    });
  }

  async function patchRow(
    ingId: string,
    patch: Partial<Pick<MenuSopIngredient, "nameFreeText" | "qty" | "unit">>,
  ) {
    const nextIng = rows.map((r) =>
      r.id === ingId
        ? {
            ...r,
            ...patch,
            unit:
              patch.unit !== undefined
                ? normalizeStockUnit(patch.unit)
                : r.unit,
          }
        : r,
    );
    setRows(nextIng);
    const nextLinks = links.map((l) => {
      if (l.ingredientId !== ingId) return l;
      const row = nextIng.find((r) => r.id === ingId);
      return {
        ...l,
        qty: row?.qty ?? l.qty,
        unit: row?.unit ?? l.unit,
      };
    });
    setLinks(nextLinks);
    if (aiPending) return;
    try {
      await persistIngredients(nextIng);
      await persistLinks(nextLinks);
    } catch (e) {
      setErr(mapFirestoreError(e));
    }
  }

  async function addManualRow() {
    const id = newIngredientId();
    const row: MenuSopIngredient = {
      id,
      nameFreeText: "",
      qty: 0,
      unit: "ก.",
    };
    const nextIng = [...rows, row];
    setRows(nextIng);
    setErr("");
    if (aiPending) return;
    try {
      await persistIngredients(nextIng);
      setMsg("เพิ่มแถวแล้ว — ใส่ชื่อ · ปริมาณ · หน่วยให้ครบ");
    } catch (e) {
      setErr(mapFirestoreError(e));
    }
  }

  async function removeRow(ingId: string) {
    const nextIng = rows.filter((r) => r.id !== ingId);
    const nextLinks = links.filter((l) => l.ingredientId !== ingId);
    setRows(nextIng);
    setLinks(nextLinks);
    if (aiPending) return;
    try {
      await persistIngredients(nextIng);
      await persistLinks(nextLinks);
    } catch (e) {
      setErr(mapFirestoreError(e));
    }
  }

  async function runAiHelp() {
    if (!ingredientsText.trim()) {
      setErr("ใส่ข้อความส่วนผสมด้านบนก่อน แล้วค่อยกด AI ช่วย");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const result = await analyzeMenuSopCost({
        sop: {
          name,
          yieldQty,
          yieldUnit,
          pieceWeightG,
          ingredientsText,
          steps: makeStepsText
            ? [{ title: "ทำ", body: makeStepsText }]
            : [],
          ingredients: rows,
        },
        stockCatalog: [
          ...baseSops.map((b) => ({
            id: encodeMenuSopBaseRef(b.id),
            name: b.name,
            unit: b.yieldUnit || "ลิตร",
            unitCost: 0,
            aliases: ["เบส", `เบส${b.name}`],
          })),
          ...stock.map((s) => ({
            id: s.id,
            name: s.name,
            unit: s.unit,
            // พนักงานใช้บล็อกนี้ — ห้ามส่งราคาเข้า AI
            unitCost: 0,
            aliases: s.aliases || [],
          })),
        ],
      });
      const nextIng: MenuSopIngredient[] = [];
      const nextLinks: MenuSopIngredientLink[] = [];
      for (const p of result.links) {
        const id = p.ingredientId || newIngredientId();
        const nameHint = p.ingredientName || p.stockName || "";
        const qty = Number(p.qty) || 0;
        const unit = normalizeStockUnit(p.unit || "ก.");
        nextIng.push({
          id,
          nameFreeText: p.ingredientName || "—",
          qty,
          unit,
        });
        const ref = parseMenuSopIngredientRef(p.stockItemId || "");
        if (ref.kind === "base") {
          const base = baseSops.find((b) => b.id === ref.id);
          if (base) {
            nextLinks.push({
              ingredientId: id,
              stockItemId: "",
              baseSopId: base.id,
              qty,
              unit: unit || base.yieldUnit || "ก.",
            });
            continue;
          }
        }
        const stockHit =
          (p.stockItemId &&
            !p.stockItemId.startsWith("base:") &&
            stock.find((s) => s.id === p.stockItemId)) ||
          findStockByNameOrAlias(stock, nameHint);
        if (stockHit) {
          nextLinks.push({
            ingredientId: id,
            stockItemId: stockHit.id,
            qty,
            unit: unit || normalizeStockUnit(stockHit.unit) || "ก.",
          });
          continue;
        }
        const baseHit = findBaseByName(nameHint);
        if (baseHit) {
          nextLinks.push({
            ingredientId: id,
            stockItemId: "",
            baseSopId: baseHit.id,
            qty,
            unit: unit || baseHit.yieldUnit || "ก.",
          });
        }
      }
      setSavedSnap({ rows, links });
      setRows(nextIng);
      setLinks(nextLinks);
      setAiPending(true);
      const missingQty = nextIng.filter((r) => !qtyLooksValid(r.qty)).length;
      const missingPair = nextIng.length - nextLinks.length;
      const localHint =
        result.model === "local-parse" ? " · แยกสูตรท้องถิ่น" : "";
      setMsg(
        `AI เสนอ ${nextIng.length} รายการ${localHint} — ตรวจปริมาณ/หน่วยแล้วกดตกลง` +
          (missingQty ? ` · ขาดปริมาณ ${missingQty}` : "") +
          (missingPair > 0 ? ` · ยังไม่คู่ ${missingPair}` : ""),
      );
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAi() {
    if (!canWrite || !actorId) return;
    setBusy(true);
    setErr("");
    try {
      await persistIngredients(rows);
      await persistLinks(links);
      setAiPending(false);
      setSavedSnap(null);
      const badQty = rows.filter((r) => !qtyLooksValid(r.qty)).length;
      setMsg(
        badQty
          ? `ใช้ข้อเสนอ AI แล้ว — ยังมี ${badQty} รายการที่ปริมาณไม่ครบ แก้ได้ในตาราง`
          : `ใช้ข้อเสนอ AI แล้ว · ${rows.length} รายการ`,
      );
    } catch (e) {
      setErr(mapFirestoreError(e));
    } finally {
      setBusy(false);
    }
  }

  function discardAi() {
    if (savedSnap) {
      setRows(savedSnap.rows);
      setLinks(savedSnap.links);
    }
    setAiPending(false);
    setSavedSnap(null);
    setMsg("ยกเลิกข้อเสนอ AI แล้ว");
  }

  const missingQtyCount = rows.filter((r) => !qtyLooksValid(r.qty)).length;

  return (
    <div className="bakery-sop-ing-ai">
      <textarea
        id={textareaId}
        rows={6}
        className="bakery-sop-textarea bakery-sop-textarea--tall"
        placeholder="เช่น นมสด 200 มล. · ไซรัปพีช 30 มล. · ไข่มุก 40 ก. — เขียนอิสระได้ แล้วกด AI ช่วยแปลงเป็นตาราง"
        value={ingredientsText}
        disabled={!canWrite || busy}
        onChange={(e) => setIngredientsText(e.target.value)}
      />

      <div className="bakery-sop-ing-table-block">
        <div className="bakery-sop-ing-table-head">
          <span className="bakery-sop-ing-table-title">ตารางส่วนผสม</span>
          {aiPending ? (
            <div className="bakery-sop-ing-ai-pending-actions">
              <button
                type="button"
                className="btn bakery-sop-fit-btn"
                disabled={busy}
                onClick={() => void confirmAi()}
              >
                <Check size={12} aria-hidden /> ตกลง
              </button>
              <button
                type="button"
                className="btn ghost bakery-sop-fit-btn"
                disabled={busy}
                onClick={discardAi}
              >
                ไม่ใช้
              </button>
            </div>
          ) : (
            <div className="bakery-sop-ing-ai-actions">
              <button
                type="button"
                className="btn ghost bakery-sop-fit-btn"
                disabled={busy}
                onClick={() => void addManualRow()}
              >
                <Plus size={12} aria-hidden /> เพิ่มรายการ
              </button>
              <button
                type="button"
                className="btn bakery-sop-fit-btn"
                disabled={busy || !ingredientsText.trim()}
                title={
                  ingredientsText.trim()
                    ? "แปลงจากข้อความบรรยาย — ยังไม่บันทึกจนกดตกลง"
                    : "ใส่ข้อความบรรยายด้านบนก่อน"
                }
                onClick={() => void runAiHelp()}
              >
                <Sparkles size={12} aria-hidden /> AI ช่วย
              </button>
            </div>
          )}
        </div>

        {aiPending ? (
          <div className="bakery-sop-ing-ai-pending" role="status">
            AI เสนอรายการด้านล่าง — ตรวจ<strong>ปริมาณและหน่วย</strong>
            ให้ครบ แล้วกดตกลง หรือแก้แถวที่ไม่ถูก
          </div>
        ) : (
          <p className="muted bakery-sop-ing-qty-hint">
            ปริมาณต่อสูตรต้องเป็นตัวเลขชัด + หน่วยมาตรฐาน
            {missingQtyCount > 0
              ? ` · ขาดปริมาณ ${missingQtyCount} รายการ`
              : ""}
          </p>
        )}

        <div className="sheet-wrap bakery-sop-ing-sheet">
          <table className="sheet-table sheet-table--dense bakery-sop-ing-table">
            <thead>
              <tr>
                <th className="bakery-sop-ing-th-name">ส่วนผสม</th>
                <th className="bakery-sop-ing-th-qty">ปริมาณ</th>
                <th className="bakery-sop-ing-th-unit">หน่วย</th>
                <th className="bakery-sop-ing-th-stock">คลัง/เบส</th>
                <th className="bakery-sop-ing-th-status">สถานะ</th>
                {canWrite ? (
                  <th className="bakery-sop-ing-th-act" aria-label="ลบ" />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={canWrite ? 6 : 5}
                    className="muted bakery-sop-cost-empty"
                  >
                    กด «เพิ่มรายการ» ใส่เอง หรือ «AI ช่วย» จากข้อความบรรยาย ·
                    จับคู่คลังปล่อยว่างได้
                  </td>
                </tr>
              ) : (
                rows.map((ing) => {
                  const link = linkFor(ing.id);
                  const paired = ingredientLinkHasPair(link);
                  const isBaseLink = !!(link?.baseSopId && !link.stockItemId);
                  const qtyOk = qtyLooksValid(ing.qty);
                  const rowBad = !qtyOk;
                  return (
                    <tr
                      key={ing.id}
                      className={
                        rowBad
                          ? "bakery-sop-ing-qty-missing"
                          : paired
                            ? undefined
                            : "bakery-sop-ing-missing"
                      }
                    >
                      <td className="bakery-sop-ing-name">
                        {canWrite ? (
                          <input
                            className="bakery-sop-ing-input"
                            value={ing.nameFreeText}
                            disabled={busy}
                            placeholder="ชื่อวัตถุดิบ"
                            aria-label="ชื่อส่วนผสม"
                            onChange={(e) => {
                              const v = e.target.value;
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.id === ing.id
                                    ? { ...r, nameFreeText: v }
                                    : r,
                                ),
                              );
                            }}
                            onBlur={(e) =>
                              void patchRow(ing.id, {
                                nameFreeText: e.target.value,
                              })
                            }
                          />
                        ) : (
                          ing.nameFreeText || "—"
                        )}
                      </td>
                      <td className="bakery-sop-ing-qty">
                        {canWrite ? (
                          <input
                            type="number"
                            className={
                              qtyOk
                                ? "bakery-sop-ing-input bakery-sop-ing-input--qty"
                                : "bakery-sop-ing-input bakery-sop-ing-input--qty is-invalid"
                            }
                            min={0}
                            step="any"
                            inputMode="decimal"
                            value={ing.qty || ""}
                            disabled={busy}
                            placeholder="0"
                            aria-label={`ปริมาณ ${ing.nameFreeText || ""}`}
                            aria-invalid={!qtyOk}
                            onChange={(e) => {
                              const q = Number(e.target.value) || 0;
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.id === ing.id ? { ...r, qty: q } : r,
                                ),
                              );
                              setLinks((prev) =>
                                prev.map((l) =>
                                  l.ingredientId === ing.id
                                    ? { ...l, qty: q }
                                    : l,
                                ),
                              );
                            }}
                            onBlur={(e) =>
                              void patchRow(ing.id, {
                                qty: Number(e.target.value) || 0,
                              })
                            }
                          />
                        ) : (
                          <span className="bakery-sop-num">
                            {ing.qty || "—"}
                          </span>
                        )}
                      </td>
                      <td className="bakery-sop-ing-unit">
                        {canWrite ? (
                          <select
                            className="bakery-sop-ing-stock-select"
                            value={
                              STOCK_UNIT_OPTIONS.some(
                                (u) => u.value === ing.unit,
                              )
                                ? ing.unit
                                : normalizeStockUnit(ing.unit) || "ก."
                            }
                            disabled={busy}
                            aria-label={`หน่วย ${ing.nameFreeText || ""}`}
                            onChange={(e) =>
                              void patchRow(ing.id, { unit: e.target.value })
                            }
                          >
                            {STOCK_UNIT_OPTIONS.map((u) => (
                              <option key={u.value} value={u.value}>
                                {u.value}
                              </option>
                            ))}
                            {ing.unit &&
                            !STOCK_UNIT_OPTIONS.some(
                              (u) => u.value === ing.unit,
                            ) ? (
                              <option value={ing.unit}>{ing.unit}</option>
                            ) : null}
                          </select>
                        ) : (
                          ing.unit || "—"
                        )}
                      </td>
                      <td className="bakery-sop-ing-stock">
                        {canWrite ? (
                          <StockBasePickField
                            value={linkSelectValue(link)}
                            displayLabel={
                              paired ? displayPairName(link) : ""
                            }
                            baseSops={baseSops}
                            stock={stock}
                            disabled={busy}
                            ariaLabel={`คู่คลัง/เบส ${ing.nameFreeText || ""}`}
                            onPick={(raw) => void pickStock(ing.id, raw)}
                          />
                        ) : !paired ? (
                          <span className="muted">ยังไม่คู่</span>
                        ) : (
                          <span
                            className={
                              isBaseLink ? "bakery-sop-base-opt" : undefined
                            }
                          >
                            {displayPairName(link)}
                          </span>
                        )}
                      </td>
                      <td className="bakery-sop-ing-status">
                        {!qtyOk ? (
                          <span className="bakery-sop-skip-pill">
                            ขาดปริมาณ
                          </span>
                        ) : !paired ? (
                          <span className="bakery-sop-skip-pill">ยังไม่คู่</span>
                        ) : isBaseLink ? (
                          <StatusMark ok label="เบส" tone="base" />
                        ) : (
                          <StatusMark ok label="คลัง" />
                        )}
                      </td>
                      {canWrite ? (
                        <td className="bakery-sop-ing-act">
                          <button
                            type="button"
                            className="btn ghost bakery-sop-ing-del"
                            disabled={busy}
                            aria-label={`ลบ ${ing.nameFreeText || "แถว"}`}
                            onClick={() => void removeRow(ing.id)}
                          >
                            <Trash2 size={12} aria-hidden />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
