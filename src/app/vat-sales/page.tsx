"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { OwnerBooksModeSwitch } from "@/components/OwnerBooksModeSwitch";
import { VatSalesMailPanel } from "@/components/vat-sales/VatSalesMailPanel";
import { VatSalesMonthClosePanel } from "@/components/vat-sales/VatSalesMonthClosePanel";
import { VatSalesReconcilePanel } from "@/components/vat-sales/VatSalesReconcilePanel";
import { VatSalesInputVatPanel } from "@/components/vat-sales/VatSalesInputVatPanel";
import { VatSalesAuditPanel } from "@/components/vat-sales/VatSalesAuditPanel";
import { VatSalesOwnerGuide } from "@/components/vat-sales/VatSalesOwnerGuide";
import { useAuth } from "@/lib/auth";
import { formatPlainNumber } from "@/lib/utils";
import { can } from "@/lib/permissions";
import {
  bangkokDateKey,
  bangkokMonthKey,
  confirmDailySales,
  dateKeysInMonth,
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_CHANNELS,
  emptyDailySales,
  fetchPosStorefrontTotalsByMonth,
  listDailySalesInMonth,
  loadVatSalesSettings,
  recomputeDailyTotals,
  saveVatSalesSettings,
  sourceLabel,
  sumMonthSales,
  unconfirmDailySales,
  upsertDailySales,
  type ChannelAmount,
  type DailySalesDoc,
  type DeliveryChannel,
  type PnlIncomeMode,
  type VatSalesSettings,
} from "@/lib/vat-sales";
import { listPlatformEmailReportsForMonth } from "@/lib/vat-sales-mail";
import {
  countDayStatuses,
  DAY_OPS_STATUS_LABELS,
  DAY_OPS_STATUS_SHORT,
  deriveDayOpsStatus,
  groupReportsByDate,
  isActionNeeded,
  CHANNEL_SHORT,
  type DayOpsStatus,
} from "@/lib/vat-sales-status";

type VatTab = "daily" | "mail" | "recon" | "input" | "close" | "audit";

export default function VatSalesPage() {
  return (
    <AuthGate>
      <VatSalesGate />
    </AuthGate>
  );
}

function VatSalesGate() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";

  useEffect(() => {
    if (staff && !isOwner) {
      router.replace(can(staff, "ownerBooks") ? "/owner-books/" : "/more/");
    }
  }, [staff, isOwner, router]);

  if (!isOwner) return null;
  return <VatSalesView actor={staff?.id || staff?.email || "owner"} />;
}

function fmt(n: number) {
  if (!n) return "—";
  return formatPlainNumber(n);
}

function fmtDay(dateKey: string) {
  const [, , d] = dateKey.split("-");
  return d;
}

function moneyInputValue(n: number) {
  return n ? String(n) : "";
}

function parseMoneyInput(raw: string): number {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

type DraftRow = {
  shopee: string;
  grab: string;
  lineman: string;
  storefront: string;
  dirty: boolean;
};

function draftsFromDocs(docs: Record<string, DailySalesDoc>): Record<string, DraftRow> {
  const out: Record<string, DraftRow> = {};
  for (const [key, doc] of Object.entries(docs)) {
    out[key] = {
      shopee: moneyInputValue(doc.delivery.shopee.grossInclusive),
      grab: moneyInputValue(doc.delivery.grab.grossInclusive),
      lineman: moneyInputValue(doc.delivery.lineman.grossInclusive),
      storefront: moneyInputValue(doc.storefront.grossInclusive),
      dirty: false,
    };
  }
  return out;
}

function channelFromDraft(
  existing: ChannelAmount,
  raw: string,
): ChannelAmount {
  return {
    ...existing,
    grossInclusive: parseMoneyInput(raw),
  };
}

/** คงแหล่งเมล/POS ถ้ายอดไม่เปลี่ยน */
function keepChannelSource(
  prev: "manual" | "pos_suggest" | "email" | undefined,
  oldAmt: number,
  newAmt: number,
): "manual" | "pos_suggest" | "email" {
  if (prev === "email" && oldAmt === newAmt) return "email";
  if (prev === "pos_suggest" && oldAmt === newAmt) return "pos_suggest";
  return "manual";
}

function VatSalesView({ actor }: { actor: string }) {
  const [tab, setTab] = useState<VatTab>("daily");
  const [month, setMonth] = useState(() => bangkokMonthKey());
  const [docs, setDocs] = useState<Record<string, DailySalesDoc>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [settings, setSettings] = useState<VatSalesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [reportEmailsText, setReportEmailsText] = useState("");
  const [reportsByDate, setReportsByDate] = useState<
    Record<string, import("@/lib/vat-sales-mail").PlatformEmailReport[]>
  >({});
  const [statusFilter, setStatusFilter] = useState<DayOpsStatus | "all" | "action">("all");
  const [highlightDay, setHighlightDay] = useState<string | null>(null);
  const [jumpDay, setJumpDay] = useState("");
  const [minGross, setMinGross] = useState("");
  const [mailFocusDate, setMailFocusDate] = useState<string | null>(null);
  const todayKey = useMemo(() => bangkokDateKey(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (
      t === "mail" ||
      t === "close" ||
      t === "daily" ||
      t === "recon" ||
      t === "input" ||
      t === "audit"
    ) {
      setTab(t);
    }
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setMailFocusDate(date);
      if (t === "mail" || !t) setTab("mail");
    }
    const mail = params.get("mail");
    const provider = params.get("provider");
    if (mail === "connected") {
      setTab("mail");
      setMsg(
        provider === "outlook" ? "เชื่อม Outlook สำเร็จ" : "เชื่อม Gmail สำเร็จ",
      );
    } else if (mail === "error") {
      setTab("mail");
      setError(
        `เชื่อม${provider === "outlook" ? " Outlook" : " Gmail"} ไม่สำเร็จ (${params.get("reason") || "error"})`,
      );
    }
  }, []);

  const dateKeys = useMemo(() => dateKeysInMonth(month), [month]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [monthDocs, vatSettings, monthReports] = await Promise.all([
        listDailySalesInMonth(month),
        loadVatSalesSettings(),
        listPlatformEmailReportsForMonth(month).catch(() => []),
      ]);
      setDocs(monthDocs);
      setDrafts(draftsFromDocs(monthDocs));
      setSettings(vatSettings);
      setReportEmailsText(vatSettings.reportEmails.join("\n"));
      setReportsByDate(groupReportsByDate(monthReports));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(
    () => dateKeys.map((k) => docs[k] || emptyDailySales(k)),
    [dateKeys, docs],
  );

  const dayStatuses = useMemo(() => {
    if (!settings) return {} as Record<string, DayOpsStatus>;
    const out: Record<string, DayOpsStatus> = {};
    for (const k of dateKeys) {
      out[k] = deriveDayOpsStatus(
        k,
        docs[k] || emptyDailySales(k),
        reportsByDate[k] || [],
        settings,
        todayKey,
      );
    }
    return out;
  }, [dateKeys, docs, reportsByDate, settings, todayKey]);

  const statusCounts = useMemo(
    () => countDayStatuses(Object.values(dayStatuses)),
    [dayStatuses],
  );

  const actionDays = useMemo(
    () => dateKeys.filter((k) => isActionNeeded(dayStatuses[k] || "empty")),
    [dateKeys, dayStatuses],
  );

  const totals = useMemo(() => sumMonthSales(rows), [rows]);
  const confirmedTotals = useMemo(
    () => sumMonthSales(rows, { confirmedOnly: true }),
    [rows],
  );

  const previewRow = useCallback(
    (dateKey: string): DailySalesDoc => {
      const base = docs[dateKey] || emptyDailySales(dateKey);
      const d = drafts[dateKey];
      if (!d) return base;
      const delivery = {
        shopee: channelFromDraft(base.delivery.shopee, d.shopee),
        grab: channelFromDraft(base.delivery.grab, d.grab),
        lineman: channelFromDraft(base.delivery.lineman, d.lineman),
      };
      const storefront = channelFromDraft(base.storefront, d.storefront);
      const recomputed = recomputeDailyTotals({ storefront, delivery });
      return { ...base, storefront, delivery, ...recomputed };
    },
    [docs, drafts],
  );

  const visibleKeys = useMemo(() => {
    let keys =
      statusFilter === "all"
        ? dateKeys
        : statusFilter === "action"
          ? actionDays
          : dateKeys.filter((k) => dayStatuses[k] === statusFilter);

    if (jumpDay.trim()) {
      const day = jumpDay.trim().padStart(2, "0");
      keys = keys.filter((k) => k.endsWith(`-${day}`) || k === jumpDay.trim());
    }

    const min = Number(String(minGross).replace(/,/g, ""));
    if (Number.isFinite(min) && min > 0) {
      keys = keys.filter((k) => previewRow(k).totalGross >= min);
    }
    return keys;
  }, [dateKeys, statusFilter, dayStatuses, actionDays, jumpDay, minGross, previewRow]);

  const setDraftField = (
    dateKey: string,
    field: "shopee" | "grab" | "lineman" | "storefront",
    value: string,
  ) => {
    setDrafts((prev) => {
      const cur = prev[dateKey] || {
        shopee: "",
        grab: "",
        lineman: "",
        storefront: "",
        dirty: false,
      };
      return {
        ...prev,
        [dateKey]: { ...cur, [field]: value, dirty: true },
      };
    });
  };

  const saveRow = async (dateKey: string) => {
    const base = docs[dateKey] || emptyDailySales(dateKey);
    if (base.status === "confirmed") {
      setError("วันนี้ยืนยันแล้ว — ปลดล็อกก่อนแก้ยอด");
      return;
    }
    const d = drafts[dateKey];
    if (!d) return;
    setBusy(dateKey);
    setError("");
    setMsg("");
    try {
      const delivery: Record<DeliveryChannel, ChannelAmount> = {
        shopee: channelFromDraft(base.delivery.shopee, d.shopee),
        grab: channelFromDraft(base.delivery.grab, d.grab),
        lineman: channelFromDraft(base.delivery.lineman, d.lineman),
      };
      const storefront = channelFromDraft(base.storefront, d.storefront);
      const sources = {
        storefront: keepChannelSource(
          base.sources.storefront,
          base.storefront.grossInclusive,
          storefront.grossInclusive,
        ),
        shopee: keepChannelSource(
          base.sources.shopee,
          base.delivery.shopee.grossInclusive,
          delivery.shopee.grossInclusive,
        ),
        grab: keepChannelSource(
          base.sources.grab,
          base.delivery.grab.grossInclusive,
          delivery.grab.grossInclusive,
        ),
        lineman: keepChannelSource(
          base.sources.lineman,
          base.delivery.lineman.grossInclusive,
          delivery.lineman.grossInclusive,
        ),
      };
      const saved = await upsertDailySales(
        { dateKey, storefront, delivery, sources },
        actor,
      );
      setDocs((prev) => ({ ...prev, [dateKey]: saved }));
      setDrafts((prev) => ({
        ...prev,
        [dateKey]: {
          shopee: moneyInputValue(saved.delivery.shopee.grossInclusive),
          grab: moneyInputValue(saved.delivery.grab.grossInclusive),
          lineman: moneyInputValue(saved.delivery.lineman.grossInclusive),
          storefront: moneyInputValue(saved.storefront.grossInclusive),
          dirty: false,
        },
      }));
      setMsg(`บันทึก ${dateKey} แล้ว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleConfirm = async (dateKey: string) => {
    const row = docs[dateKey] || emptyDailySales(dateKey);
    setBusy(dateKey);
    setError("");
    setMsg("");
    try {
      if (row.status !== "confirmed" && drafts[dateKey]?.dirty) {
        const base = docs[dateKey] || emptyDailySales(dateKey);
        const d = drafts[dateKey]!;
        const delivery: Record<DeliveryChannel, ChannelAmount> = {
          shopee: channelFromDraft(base.delivery.shopee, d.shopee),
          grab: channelFromDraft(base.delivery.grab, d.grab),
          lineman: channelFromDraft(base.delivery.lineman, d.lineman),
        };
        const storefront = channelFromDraft(base.storefront, d.storefront);
        await upsertDailySales(
          {
            dateKey,
            storefront,
            delivery,
            sources: {
              storefront: keepChannelSource(
                base.sources.storefront,
                base.storefront.grossInclusive,
                storefront.grossInclusive,
              ),
              shopee: keepChannelSource(
                base.sources.shopee,
                base.delivery.shopee.grossInclusive,
                delivery.shopee.grossInclusive,
              ),
              grab: keepChannelSource(
                base.sources.grab,
                base.delivery.grab.grossInclusive,
                delivery.grab.grossInclusive,
              ),
              lineman: keepChannelSource(
                base.sources.lineman,
                base.delivery.lineman.grossInclusive,
                delivery.lineman.grossInclusive,
              ),
            },
          },
          actor,
        );
      }
      const next =
        row.status === "confirmed"
          ? await unconfirmDailySales(dateKey, actor)
          : await confirmDailySales(dateKey, actor);
      setDocs((prev) => ({ ...prev, [dateKey]: next }));
      setDrafts((prev) => ({
        ...prev,
        [dateKey]: {
          shopee: moneyInputValue(next.delivery.shopee.grossInclusive),
          grab: moneyInputValue(next.delivery.grab.grossInclusive),
          lineman: moneyInputValue(next.delivery.lineman.grossInclusive),
          storefront: moneyInputValue(next.storefront.grossInclusive),
          dirty: false,
        },
      }));
      setMsg(next.status === "confirmed" ? `ยืนยัน ${dateKey}` : `ปลดล็อก ${dateKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmAllReady = async () => {
    const ready = dateKeys.filter((k) => dayStatuses[k] === "ready");
    if (ready.length === 0) {
      setError("ไม่มีวันที่สถานะพร้อมยืนยัน");
      return;
    }
    const dirty = ready.filter((k) => drafts[k]?.dirty);
    if (dirty.length > 0) {
      setError(`มี ${dirty.length} วันยังไม่บันทึก — บันทึกก่อนยืนยันทั้งชุด`);
      return;
    }
    if (!window.confirm(`ยืนยันทั้ง ${ready.length} วันที่พร้อมในเดือน ${month}?`)) return;
    setBusy("bulk-confirm");
    setError("");
    setMsg("");
    try {
      let n = 0;
      for (const dateKey of ready) {
        const next = await confirmDailySales(dateKey, actor);
        setDocs((prev) => ({ ...prev, [dateKey]: next }));
        n += 1;
      }
      setMsg(`ยืนยันแล้ว ${n} วัน`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const jumpToDay = () => {
    const raw = jumpDay.trim();
    if (!raw) return;
    const key = raw.includes("-") ? raw : `${month}-${raw.padStart(2, "0")}`;
    setHighlightDay(key);
    const el = document.getElementById(`vat-day-${key}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const pullPosMonth = async () => {
    if (!window.confirm(`ดึงยอดหน้าร้านจาก POS ทั้งเดือน ${month}? ค่าที่มาจากมือ/เมลจะถามก่อนทับ`)) {
      return;
    }
    setBusy("pos");
    setError("");
    setMsg("");
    try {
      const totalsByDay = await fetchPosStorefrontTotalsByMonth(month);
      let applied = 0;
      let skipped = 0;
      for (const dateKey of dateKeys) {
        const suggested = totalsByDay[dateKey] || 0;
        if (suggested <= 0) continue;
        const row = docs[dateKey] || emptyDailySales(dateKey);
        if (row.status === "confirmed") {
          skipped += 1;
          continue;
        }
        const current = row.storefront.grossInclusive;
        if (current > 0 && current !== suggested && row.sources.storefront !== "pos_suggest") {
          const ok = window.confirm(
            `${dateKey}: มียอดหน้าร้าน ${formatPlainNumber(current)} อยู่แล้ว — ทับด้วย POS ${formatPlainNumber(suggested)}?`,
          );
          if (!ok) {
            skipped += 1;
            continue;
          }
        }
        const saved = await upsertDailySales(
          {
            dateKey,
            storefront: {
              ...row.storefront,
              grossInclusive: suggested,
            },
            sources: { storefront: "pos_suggest" },
          },
          actor,
        );
        setDocs((prev) => ({ ...prev, [dateKey]: saved }));
        setDrafts((prev) => ({
          ...prev,
          [dateKey]: {
            ...(prev[dateKey] || {
              shopee: "",
              grab: "",
              lineman: "",
              storefront: "",
              dirty: false,
            }),
            storefront: moneyInputValue(saved.storefront.grossInclusive),
            dirty: false,
          },
        }));
        applied += 1;
      }
      setMsg(`ดึง POS แล้ว ${applied} วัน · ข้าม ${skipped} วัน`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy("settings");
    setError("");
    setMsg("");
    try {
      const emails = reportEmailsText
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const next = await saveVatSalesSettings(
        {
          vatRegistered: settings.vatRegistered,
          pnlIncomeMode: settings.pnlIncomeMode,
          channelsEnabled: settings.channelsEnabled,
          reportEmails: emails,
          mailRules: settings.mailRules,
          alertsEnabled: settings.alertsEnabled,
          alertAfterHourBangkok: settings.alertAfterHourBangkok,
        },
        actor,
      );
      setSettings(next);
      setReportEmailsText(next.reportEmails.join("\n"));
      setMsg("บันทึกตั้งค่าแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveMailRulesOnly = async () => {
    if (!settings) return;
    setBusy("mail-rules");
    setError("");
    setMsg("");
    try {
      const next = await saveVatSalesSettings({ mailRules: settings.mailRules }, actor);
      setSettings(next);
      setMsg("บันทึกกฎค้นหาเมลแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vat-sales-page vat-sales-page--compact owner-books-page">
      <OwnerBooksModeSwitch active="vat" />
      <header className="vat-sales-header">
        <div>
          <h1 className="panel-title">ยอดขาย / VAT</h1>
          <VatSalesOwnerGuide />
        </div>
        <div className="vat-sales-tabs" role="tablist">
          {(
            [
              ["daily", "วัน"],
              ["mail", "เมล"],
              ["recon", "เทียบ"],
              ["input", "ซื้อ"],
              ["close", "ปิด"],
              ["audit", "ประวัติ"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={tab === id ? "vat-sales-tab is-active" : "vat-sales-tab"}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      {tab === "mail" ? (
        settings ? (
          <VatSalesMailPanel
            actor={actor}
            settings={settings}
            onSettingsChange={setSettings}
            onSaveMailRules={saveMailRulesOnly}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            setMsg={setMsg}
            focusDate={mailFocusDate}
          />
        ) : (
          <p className="muted">กำลังโหลด...</p>
        )
      ) : null}

      {tab === "recon" ? (
        <VatSalesReconcilePanel
          month={month}
          onMonthChange={setMonth}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
        />
      ) : null}

      {tab === "input" ? (
        <VatSalesInputVatPanel
          month={month}
          onMonthChange={setMonth}
          actor={actor}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
          outputVat={confirmedTotals.vatOutput}
        />
      ) : null}

      {tab === "close" ? (
        <VatSalesMonthClosePanel
          month={month}
          onMonthChange={setMonth}
          actor={actor}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setMsg={setMsg}
        />
      ) : null}

      {tab === "audit" ? (
        <VatSalesAuditPanel
          month={month}
          onMonthChange={setMonth}
          setError={setError}
        />
      ) : null}

      {tab === "daily" ? (
        <>
        <div className="vat-sales-toolbar vat-sales-toolbar--slim" style={{ marginBottom: "0.45rem" }}>
          <label className="vat-sales-month">
            เดือน
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== null || loading}
            onClick={() => void refresh()}
          >
            รี
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null || loading}
            onClick={() => void pullPosMonth()}
          >
            POS
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "ซ่อน" : "ตั้งค่า"}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null || loading || statusCounts.ready <= 0}
            onClick={() => void confirmAllReady()}
          >
            {busy === "bulk-confirm"
              ? "…"
              : `ยืนยัน (${statusCounts.ready})`}
          </button>
          <label className="vat-sales-month">
            วัน
            <input
              inputMode="numeric"
              placeholder="15"
              value={jumpDay}
              onChange={(e) => setJumpDay(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToDay();
              }}
              style={{ width: "3.2rem" }}
            />
          </label>
          <button type="button" className="ghost-btn" onClick={jumpToDay}>
            ไป
          </button>
          <label className="vat-sales-month">
            ≥
            <input
              inputMode="decimal"
              placeholder="0"
              value={minGross}
              onChange={(e) => setMinGross(e.target.value)}
              style={{ width: "4rem" }}
            />
          </label>
          <label className="vat-sales-month">
            สถ
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="all">ทั้งหมด</option>
              <option value="action">ต้องจัดการ</option>
              {(Object.keys(DAY_OPS_STATUS_LABELS) as DayOpsStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DAY_OPS_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

      {actionDays.length > 0 ? (
        <section className="vat-sales-action-board vat-sales-action-board--slim">
          <div className="vat-sales-action-chips">
            {actionDays.slice(0, 31).map((d) => (
              <button
                key={d}
                type="button"
                className="vat-sales-action-chip"
                onClick={() => {
                  setHighlightDay(d);
                  setStatusFilter("action");
                  const el = document.getElementById(`vat-day-${d}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <span title={DAY_OPS_STATUS_LABELS[dayStatuses[d] || "empty"]}>
                  {d.slice(8)}·{DAY_OPS_STATUS_SHORT[dayStatuses[d] || "empty"]}
                </span>
              </button>
            ))}
          </div>
          <p className="muted vat-sales-hint">
            ขาด {statusCounts.missing_mail} · รอ {statusCounts.pending_review} ·
            fail {statusCounts.parse_error} · ค้าง {statusCounts.incomplete} ·
            พร้อม {statusCounts.ready} · OK {statusCounts.confirmed}
          </p>
        </section>
      ) : null}

      <p className="muted vat-sales-hint">
        ยืนยันแล้ว→P&amp;L หลังปิดเดือน · ฐาน {fmt(confirmedTotals.vatBase)} · VAT{" "}
        {fmt(confirmedTotals.vatOutput)} · รวม {fmt(confirmedTotals.totalGross)}
      </p>

      {showSettings && settings ? (
        <section className="vat-sales-settings vat-sales-settings--slim">
          <h2 className="vat-sales-section-title">ตั้งค่าภาษี / ช่องทาง</h2>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.vatRegistered}
              onChange={(e) =>
                setSettings({ ...settings, vatRegistered: e.target.checked })
              }
            />
            จด VAT แล้ว (ใช้เป็นบริบท — ยังไม่ยื่นแบบอัตโนมัติ)
          </label>
          <label className="vat-sales-field">
            รายได้เข้า P&amp;L
            <select
              value={settings.pnlIncomeMode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  pnlIncomeMode: e.target.value as PnlIncomeMode,
                })
              }
            >
              <option value="exVat">ยอดก่อน VAT (แนะนำ)</option>
              <option value="incVat">ยอดรวม VAT</option>
            </select>
          </label>
          <div className="vat-sales-channels">
            <span className="muted">ช่องทางที่เปิดใช้</span>
            {(
              [
                ["shopee", "ShopeeFood"],
                ["grab", "Grab"],
                ["lineman", "LINE MAN"],
                ["storefront", "หน้าร้าน"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check-row">
                <input
                  type="checkbox"
                  checked={settings.channelsEnabled[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      channelsEnabled: {
                        ...settings.channelsEnabled,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label className="vat-sales-field">
            อีเมลรับรายงานแพลตฟอร์ม (เตรียมดึงเมล)
            <textarea
              rows={3}
              value={reportEmailsText}
              onChange={(e) => setReportEmailsText(e.target.value)}
              placeholder="one@email.com"
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.alertsEnabled}
              onChange={(e) =>
                setSettings({ ...settings, alertsEnabled: e.target.checked })
              }
            />
            แจ้งเตือนเจ้าของเมื่อขาดเมล / parse พัง (เฉพาะ owner push)
          </label>
          <label className="vat-sales-field">
            ชั่วโมงแจ้งเตือน (Bangkok)
            <input
              type="number"
              min={0}
              max={23}
              value={settings.alertAfterHourBangkok}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  alertAfterHourBangkok: Number(e.target.value) || 0,
                })
              }
            />
          </label>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void saveSettings()}
          >
            บันทึกตั้งค่า
          </button>
        </section>
      ) : null}

      <section className="vat-sales-summary vat-sales-summary--slim">
        <span>
          ส่ง <strong>{fmt(totals.deliveryGross)}</strong>
          <small className="muted">
            {" "}
            Sp {fmt(totals.shopee)} · G {fmt(totals.grab)} · LM {fmt(totals.lineman)}
          </small>
        </span>
        <span>
          ร้าน <strong>{fmt(totals.storefrontGross)}</strong>
        </span>
        <span className="vat-sales-summary-main">
          รวม <strong>{fmt(totals.totalGross)}</strong>
        </span>
        <span>
          ฐาน <strong>{fmt(totals.vatBase)}</strong>
        </span>
        <span>
          VAT <strong>{fmt(totals.vatOutput)}</strong>
        </span>
        <span className="muted">
          GP {fmt(totals.feeTotal)} · โอน {fmt(totals.netTransferTotal)} ·{" "}
          {totals.confirmedDays}/{dateKeys.length}
        </span>
      </section>

      <p className="muted vat-sales-hint vat-sales-glossary">
        ยอดเซลล์ = รวม VAT ลูกค้า · ฐาน=÷1.07 · GP/โอนไม่ใช่ฐาน VAT · ยืนยันวันก่อนปิดเดือน
      </p>

      {loading ? (
        <p className="muted">กำลังโหลด...</p>
      ) : (
        <div className="sheet-wrap vat-sales-scroll">
          <table className="sheet-table vat-sales-table vat-sales-table--slim">
            <thead>
              <tr>
                <th className="col-date">ว</th>
                {DELIVERY_CHANNELS.map((ch) => (
                  <th key={ch} className="col-num" title={DELIVERY_CHANNEL_LABELS[ch]}>
                    {CHANNEL_SHORT[ch]}
                  </th>
                ))}
                <th className="col-num">ร้าน</th>
                <th className="col-num">รวม</th>
                <th className="col-num">ฐาน</th>
                <th className="col-num">VAT</th>
                <th>สถ</th>
                <th className="col-act" />
              </tr>
            </thead>
            <tbody>
              {visibleKeys.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty">
                    ไม่มีวันที่ตรงตัวกรอง
                  </td>
                </tr>
              ) : (
              visibleKeys.map((dateKey) => {
                const row = docs[dateKey] || emptyDailySales(dateKey);
                const draft = drafts[dateKey];
                const preview = previewRow(dateKey);
                const locked = row.status === "confirmed";
                const dayBusy = busy === dateKey;
                const ops = dayStatuses[dateKey] || "empty";
                const bookLabel = locked ? "OK" : draft?.dirty ? "…" : "ร่าง";
                return (
                  <tr
                    key={dateKey}
                    id={`vat-day-${dateKey}`}
                    className={[
                      locked ? "vat-sales-row-confirmed" : "",
                      highlightDay === dateKey ? "vat-sales-row-highlight" : "",
                      isActionNeeded(ops) ? "vat-sales-row-action" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                  >
                    <td className="col-date" title={sourceLabel(row.sources.storefront)}>
                      {fmtDay(dateKey)}
                    </td>
                    {DELIVERY_CHANNELS.map((ch) => (
                      <td key={ch} className="col-num">
                        <input
                          className="vat-sales-input"
                          inputMode="decimal"
                          disabled={locked || dayBusy}
                          value={draft?.[ch] ?? ""}
                          onChange={(e) => setDraftField(dateKey, ch, e.target.value)}
                          aria-label={`${DELIVERY_CHANNEL_LABELS[ch]} ${dateKey}`}
                        />
                      </td>
                    ))}
                    <td className="col-num">
                      <input
                        className="vat-sales-input"
                        inputMode="decimal"
                        disabled={locked || dayBusy}
                        value={draft?.storefront ?? ""}
                        onChange={(e) =>
                          setDraftField(dateKey, "storefront", e.target.value)
                        }
                        aria-label={`หน้าร้าน ${dateKey}`}
                      />
                    </td>
                    <td className="col-num">
                      <strong>{fmt(preview.totalGross)}</strong>
                    </td>
                    <td className="col-num">{fmt(preview.vatBase)}</td>
                    <td className="col-num">{fmt(preview.vatOutput)}</td>
                    <td>
                      <span
                        className={`vat-ops-badge vat-ops-${ops}`}
                        title={`${DAY_OPS_STATUS_LABELS[ops]} · บช.${bookLabel}`}
                      >
                        {DAY_OPS_STATUS_SHORT[ops]}
                        {locked || draft?.dirty ? `·${bookLabel}` : ""}
                      </span>
                    </td>
                    <td className="col-act">
                      <div className="vat-sales-acts">
                        {!locked ? (
                          <button
                            type="button"
                            className="primary-btn vat-sales-act-btn"
                            disabled={dayBusy || busy !== null}
                            onClick={() => void saveRow(dateKey)}
                          >
                            เซฟ
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ghost-btn vat-sales-act-btn"
                          disabled={dayBusy || busy !== null}
                          onClick={() => void toggleConfirm(dateKey)}
                        >
                          {locked ? "ปลด" : "ยืน"}
                        </button>
                        {ops === "pending_review" || ops === "parse_error" || ops === "missing_mail" ? (
                          <button
                            type="button"
                            className="ghost-btn vat-sales-act-btn"
                            onClick={() => {
                              setMailFocusDate(dateKey);
                              setTab("mail");
                            }}
                          >
                            เมล
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
              )}
            </tbody>
            <tfoot>
              <tr className="vat-sales-totals-row">
                <td className="col-date">Σ</td>
                <td className="col-num">{fmt(totals.shopee)}</td>
                <td className="col-num">{fmt(totals.grab)}</td>
                <td className="col-num">{fmt(totals.lineman)}</td>
                <td className="col-num">{fmt(totals.storefrontGross)}</td>
                <td className="col-num">{fmt(totals.totalGross)}</td>
                <td className="col-num">{fmt(totals.vatBase)}</td>
                <td className="col-num">{fmt(totals.vatOutput)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}
