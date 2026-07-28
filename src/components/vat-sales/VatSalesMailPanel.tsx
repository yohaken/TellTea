"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeShort, formatPlainNumber } from "@/lib/utils";
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_CHANNELS,
  getDailySales,
  type DeliveryChannel,
  type VatSalesSettings,
} from "@/lib/vat-sales";
import {
  channelReportLabel,
  confirmEmailSalesToDaily,
  disconnectVatMail,
  fetchVatMailStatus,
  listPlatformEmailReports,
  loadVatMailOAuthConfig,
  parseStatusLabel,
  pullAndFillDailyFromMail,
  reparsePendingPlatformEmails,
  reparsePlatformEmailReport,
  saveVatMailOAuthConfig,
  setPlatformEmailIgnored,
  startVatMailOAuth,
  syncVatMail,
  type MailParseStatus,
  type PlatformEmailReport,
  type VatMailMailbox,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";
import { loadParserHealth, type ParserHealthSummary } from "@/lib/vat-sales-parser-health";
import { prunePlatformEmailRaw } from "@/lib/vat-sales-mail-prune";

const DEFAULT_REDIRECT =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/vatMailOAuthCallback";
function reportKindLabel(kind: string) {
  if (kind === "weekly") return "สัปดาห์";
  if (kind === "monthly") return "เดือน";
  return "วัน";
}

type Props = {
  actor: string;
  settings: VatSalesSettings;
  onSettingsChange: (next: VatSalesSettings) => void;
  onSaveMailRules: () => Promise<void>;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
  /** กรอง/โฟกัสวันจากตารางรายวัน */
  focusDate?: string | null;
};

export function VatSalesMailPanel({
  actor,
  settings,
  onSettingsChange,
  onSaveMailRules,
  busy,
  setBusy,
  setError,
  setMsg,
  focusDate = null,
}: Props) {
  const [status, setStatus] = useState<VatMailStatus | null>(null);
  const [statusLm, setStatusLm] = useState<VatMailStatus | null>(null);
  const [reports, setReports] = useState<PlatformEmailReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<"all" | DeliveryChannel | "unknown">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<MailParseStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cfgClientId, setCfgClientId] = useState("");
  const [cfgSecret, setCfgSecret] = useState("");
  const [cfgRedirect, setCfgRedirect] = useState(DEFAULT_REDIRECT);
  const [hasSecret, setHasSecret] = useState(false);
  const [health, setHealth] = useState<ParserHealthSummary | null>(null);
  const [pruneMonths, setPruneMonths] = useState("12");
  const [review, setReview] = useState<{
    reportDate: string;
    grossInclusive: string;
    fee: string;
    netTransfer: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [st, stLm, rows, cfg, healthSum] = await Promise.all([
        fetchVatMailStatus("primary"),
        fetchVatMailStatus("lineman"),
        listPlatformEmailReports({
          channel: channelFilter,
          parseStatus: statusFilter,
          max: 80,
        }),
        loadVatMailOAuthConfig().catch(() => null),
        loadParserHealth(200).catch(() => null),
      ]);
      setStatus(st);
      setStatusLm(stLm);
      let nextRows = rows;
      if (focusDate) {
        nextRows = rows.filter((r) => {
          const d = r.parsed?.reportDate || r.reportDateGuess || "";
          return d === focusDate || d.startsWith(focusDate);
        });
        if (nextRows.length === 0) nextRows = rows;
      }
      setReports(nextRows);
      setHealth(healthSum);
      if (cfg) {
        setCfgClientId(cfg.clientId);
        setCfgRedirect(cfg.redirectUri || DEFAULT_REDIRECT);
        setHasSecret(cfg.hasSecret);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter, focusDate, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (mailbox: VatMailMailbox = "primary") => {
    setBusy(mailbox === "lineman" ? "mail-connect-lm" : "mail-connect");
    setError("");
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/vat-sales/?tab=mail`
          : "https://telltea-shop.web.app/vat-sales/?tab=mail";
      const url = await startVatMailOAuth(returnTo, mailbox);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const disconnect = async (mailbox: VatMailMailbox = "primary") => {
    const label = mailbox === "lineman" ? "Gmail LINE MAN" : "Gmail";
    if (!window.confirm(`ตัดการเชื่อม ${label}?`)) return;
    setBusy(mailbox === "lineman" ? "mail-disconnect-lm" : "mail-disconnect");
    setError("");
    try {
      await disconnectVatMail(mailbox);
      setMsg(`ตัดการเชื่อม ${label} แล้ว`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sync = async (mailbox: VatMailMailbox = "primary") => {
    const label = mailbox === "lineman" ? "Gmail LINE MAN" : "Gmail";
    setBusy(mailbox === "lineman" ? "mail-sync-lm" : "mail-sync");
    setError("");
    setMsg("");
    try {
      const res = await syncVatMail(31, mailbox);
      setMsg(
        `ซิงก์ ${label} แล้ว · สแกน ${res.scanned} · เพิ่ม ${res.added} · ข้ามซ้ำ ${res.skipped}`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** ดึงเมล → parse → ลงร่างตารางทีละแพลตฟอร์ม */
  const pullAndFill = async () => {
    setBusy("mail-auto");
    setError("");
    setMsg("กำลังดึงเมล…");
    try {
      const res = await pullAndFillDailyFromMail({
        actor,
        lookbackDays: 31,
        syncPrimary: Boolean(status?.connected),
        syncLineman: Boolean(statusLm?.connected),
      });
      const syncParts = res.sync.map((s) => {
        const name = s.mailbox === "lineman" ? "LM" : "Gmail";
        if (!s.ok) return `${name}✗`;
        return `${name}+${s.added ?? 0}`;
      });
      const short: Record<string, string> = { shopee: "Sp", grab: "G", lineman: "LM" };
      const applyParts = res.apply.map(
        (a) => `${short[a.channel] || a.channel}:${a.applied}`,
      );
      const appliedTotal = res.apply.reduce((n, a) => n + a.applied, 0);
      setMsg(
        `ลงตารางแล้ว ${appliedTotal} วัน · ซิงก์ ${syncParts.join(" · ") || "—"} · parse ${res.parse.ok}/${res.parse.fail} · ${applyParts.join(" · ")}`,
      );
      setStatusFilter("confirmed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };


  const runPruneRaw = async (dryRun: boolean) => {
    const months = Number(pruneMonths) || 12;
    if (!dryRun) {
      const ok = window.confirm(
        `ลบเนื้อหา raw ของเมลเก่ากว่า ${months} เดือน?\nเก็บ metadata/parsed ไว้ · ย้อนกลับไม่ได้`,
      );
      if (!ok) return;
    }
    setBusy(dryRun ? "mail-prune-dry" : "mail-prune");
    setError("");
    setMsg("");
    try {
      const res = await prunePlatformEmailRaw({
        months,
        actor,
        dryRun,
      });
      setMsg(
        `${dryRun ? "ตรวจแล้ว" : "ลบ raw แล้ว"} · สแกน ${res.scanned} · เข้าเกณฑ์ ${res.pruned} ฉบับ (เก่ากว่า ${res.months} เดือน)`,
      );
      if (!dryRun) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runParsePending = async () => {
    setBusy("mail-parse");
    setError("");
    setMsg("");
    try {
      const res = await reparsePendingPlatformEmails(50);
      setMsg(`Parse แล้ว · สำเร็จ ${res.ok} · ไม่ผ่าน ${res.fail} · ข้าม ${res.skipped}`);
      setStatusFilter("ok");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openReport = (r: PlatformEmailReport) => {
    if (openId === r.id) {
      setOpenId(null);
      setReview(null);
      return;
    }
    setOpenId(r.id);
    if (r.parsed) {
      setReview({
        reportDate: r.parsed.reportDate,
        grossInclusive: String(r.parsed.grossInclusive || ""),
        fee: String(r.parsed.fee || ""),
        netTransfer: String(r.parsed.netTransfer || ""),
      });
    } else {
      setReview({
        reportDate: r.reportDateGuess || "",
        grossInclusive: "",
        fee: "",
        netTransfer: "",
      });
    }
  };

  const parseOne = async (r: PlatformEmailReport) => {
    setBusy(r.id);
    setError("");
    try {
      const next = await reparsePlatformEmailReport(r);
      await refresh();
      setOpenId(next.id);
      if (next.parsed) {
        setReview({
          reportDate: next.parsed.reportDate,
          grossInclusive: String(next.parsed.grossInclusive || ""),
          fee: String(next.parsed.fee || ""),
          netTransfer: String(next.parsed.netTransfer || ""),
        });
      }
      if (next.parseStatus === "fail") {
        setError(next.parseError || "parse ไม่ผ่าน");
      } else {
        setMsg(`Parse สำเร็จ · ${channelReportLabel(next.channel)}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmOne = async (r: PlatformEmailReport, overwrite: boolean) => {
    if (!review) return;
    if (r.channel === "unknown") {
      setError("ระบุช่องทางก่อนยืนยัน");
      return;
    }
    const reportDate = review.reportDate.trim();
    const gross = Number(String(review.grossInclusive).replace(/,/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      setError("วันที่รายงานไม่ถูกต้อง");
      return;
    }
    if (!Number.isFinite(gross) || gross < 0) {
      setError("ยอดลูกค้าไม่ถูกต้อง");
      return;
    }
    setBusy(r.id);
    setError("");
    setMsg("");
    try {
      if (!overwrite) {
        const day = await getDailySales(reportDate);
        const prev = day.delivery[r.channel].grossInclusive;
        if (prev > 0 && Math.abs(prev - gross) > 0.009) {
          const ok = window.confirm(
            `${reportDate} มียอด ${channelReportLabel(r.channel)} ${formatPlainNumber(prev)} อยู่แล้ว — ทับด้วย ${formatPlainNumber(gross)}?`,
          );
          if (!ok) {
            setBusy(null);
            return;
          }
          overwrite = true;
        }
      }
      const res = await confirmEmailSalesToDaily({
        reportId: r.id,
        channel: r.channel,
        reportDate,
        grossInclusive: gross,
        fee: Number(String(review.fee).replace(/,/g, "")) || 0,
        netTransfer: Number(String(review.netTransfer).replace(/,/g, "")) || 0,
        overwrite,
        actor,
      });
      setMsg(`ยืนยันเข้าตาราง ${res.dateKey} · ${channelReportLabel(r.channel)}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = async () => {
    setBusy("mail-config");
    setError("");
    try {
      await saveVatMailOAuthConfig({
        clientId: cfgClientId,
        clientSecret: cfgSecret || undefined,
        redirectUri: (cfgRedirect || DEFAULT_REDIRECT).trim() || DEFAULT_REDIRECT,
        updatedBy: actor,
      });
      setCfgSecret("");
      setMsg("บันทึก OAuth config แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const updateRuleList = (
    channel: DeliveryChannel,
    field: "fromIncludes" | "subjectIncludes",
    text: string,
  ) => {
    const list = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSettingsChange({
      ...settings,
      mailRules: {
        ...settings.mailRules,
        [channel]: {
          ...settings.mailRules[channel],
          [field]: list,
        },
      },
    });
  };

  const open = reports.find((r) => r.id === openId) || null;

  return (
    <div className="vat-mail-panel vat-mail-panel--slim">
      {focusDate ? (
        <p className="muted vat-sales-msg">โฟกัส {focusDate}</p>
      ) : null}
      {health?.driftChannels?.length ? (
        <p className="error-text">
          drift:{" "}
          {health.driftChannels
            .map((ch) =>
              ch === "unknown" ? "?" : DELIVERY_CHANNEL_LABELS[ch],
            )
            .join(", ")}{" "}
          · อัป parser
        </p>
      ) : null}

      <section className="vat-api-box">
        <div className="vat-api-head">
          <h2 className="vat-sales-section-title">API เมล</h2>
          <span className="muted">Gmail สองกล่อง · Client ID ชุดเดียว</span>
        </div>

        <div className="vat-api-row">
          <div className="vat-api-label">
            <strong>Gmail</strong>
            <span className="muted">
              {status?.connected
                ? status.email || "ok"
                : status?.hasConfig
                  ? "พร้อมเชื่อม"
                  : "ยังไม่ตั้งค่า"}
            </span>
          </div>
          <div className="vat-sales-acts">
            {!status?.connected ? (
              <button type="button" className="primary-btn vat-sales-act-btn" disabled={busy !== null} onClick={() => void connect("primary")}>
                เชื่อม
              </button>
            ) : (
              <>
                <button type="button" className="primary-btn vat-sales-act-btn" disabled={busy !== null} onClick={() => void sync("primary")}>
                  {busy === "mail-sync" ? "…" : "ซิงก์"}
                </button>
                <button type="button" className="ghost-btn vat-sales-act-btn" disabled={busy !== null} onClick={() => void disconnect("primary")}>
                  ตัด
                </button>
              </>
            )}
            <button type="button" className="ghost-btn vat-sales-act-btn" onClick={() => setShowConfig((v) => !v)}>
              {showConfig ? "ปิดค่า" : "ตั้งค่า"}
            </button>
          </div>
        </div>

        <div className="vat-api-row">
          <div className="vat-api-label">
            <strong>Gmail LINE MAN</strong>
            <span className="muted">
              {statusLm?.connected
                ? statusLm.email || "ok"
                : status?.hasConfig || statusLm?.hasConfig
                  ? "พร้อมเชื่อม · บัญชี LM"
                  : "ยังไม่ตั้งค่า"}
            </span>
          </div>
          <div className="vat-sales-acts">
            {!statusLm?.connected ? (
              <button
                type="button"
                className="primary-btn vat-sales-act-btn"
                disabled={busy !== null || !(status?.hasConfig || statusLm?.hasConfig)}
                onClick={() => void connect("lineman")}
              >
                เชื่อม
              </button>
            ) : (
              <>
                <button type="button" className="primary-btn vat-sales-act-btn" disabled={busy !== null} onClick={() => void sync("lineman")}>
                  {busy === "mail-sync-lm" ? "…" : "ซิงก์"}
                </button>
                <button type="button" className="ghost-btn vat-sales-act-btn" disabled={busy !== null} onClick={() => void disconnect("lineman")}>
                  ตัด
                </button>
              </>
            )}
          </div>
        </div>
        {status?.lastSyncError ? (
          <p className="error-text">Gmail: {status.lastSyncError}</p>
        ) : null}
        {statusLm?.lastSyncError ? (
          <p className="error-text">LINE MAN: {statusLm.lastSyncError}</p>
        ) : null}

        {showConfig ? (
          <div className="vat-mail-config vat-api-fields">
            <label className="vat-sales-field">
              Client ID
              <input value={cfgClientId} onChange={(e) => setCfgClientId(e.target.value)} autoComplete="off" placeholder="….apps.googleusercontent.com" />
            </label>
            <label className="vat-sales-field">
              Client Secret {hasSecret ? "(มีแล้ว — ใส่ใหม่ถ้าเปลี่ยน)" : ""}
              <input type="password" value={cfgSecret} onChange={(e) => setCfgSecret(e.target.value)} autoComplete="off" placeholder={hasSecret ? "••••••" : ""} />
            </label>
            <p className="muted vat-api-hint">
              Redirect ติดมาให้แล้ว · วางใน Google Cloud:
              <code className="vat-api-code">{DEFAULT_REDIRECT}</code>
            </p>
            <p className="muted vat-api-hint">
              ตั้งค่าชุดเดียวใช้ทั้ง Gmail หลักและ Gmail LINE MAN · ตอนเชื่อมเลือกบัญชีที่ต่างกัน
            </p>
            <button type="button" className="primary-btn" disabled={busy !== null} onClick={() => void saveConfig()}>
              บันทึก Gmail
            </button>
          </div>
        ) : null}


        <div className="vat-sales-toolbar vat-api-actions">
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void pullAndFill()}
            title="ซิงก์ → parse → ลงร่างตารางทีละ Shopee / Grab / LINE MAN"
          >
            {busy === "mail-auto" ? "กำลังลงตาราง…" : "ดึงลงตาราง"}
          </button>
          <button type="button" className="ghost-btn" disabled={busy !== null || loading} onClick={() => void refresh()}>
            รีเฟรช
          </button>
          <button type="button" className="ghost-btn" disabled={busy !== null} onClick={() => void runParsePending()}>
            {busy === "mail-parse" ? "…" : "Parse คิว"}
          </button>
          {health ? (
            <span className="muted vat-api-health">
              parser {health.fail}/{health.total}
              {health.failRate != null ? ` · ${health.failRate}% fail` : ""}
            </span>
          ) : null}
        </div>
        <p className="muted vat-api-hint">
          ดึงลงตาราง = ซิงก์เมล → parse → ใส่ยอดเข้าตารางทีละแพลตฟอร์ม (วันยังเป็นร่าง · ไม่ทับวันที่ยืนยันแล้ว)
        </p>
      </section>

      <div className="vat-sales-toolbar" style={{ marginBottom: "0.5rem" }}>
        <button type="button" className="ghost-btn" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "ซ่อนขั้นสูง" : "ขั้นสูง (กฎค้นหา / ลบ raw)"}
        </button>
      </div>

      {showAdvanced ? (
      <>
      <section className="vat-sales-settings">
        <h2 className="vat-sales-section-title">กฎค้นหาเมลต่อช่องทาง</h2>
        {DELIVERY_CHANNELS.map((ch) => {
          const rule = settings.mailRules[ch];
          return (
            <div key={ch} className="vat-mail-rule">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      mailRules: {
                        ...settings.mailRules,
                        [ch]: { ...rule, enabled: e.target.checked },
                      },
                    })
                  }
                />
                <strong>{DELIVERY_CHANNEL_LABELS[ch]}</strong>
              </label>
              <label className="vat-sales-field">
                from รวมคำ (คั่นด้วย comma/บรรทัด)
                <textarea
                  rows={2}
                  value={rule.fromIncludes.join(", ")}
                  onChange={(e) => updateRuleList(ch, "fromIncludes", e.target.value)}
                />
              </label>
              <label className="vat-sales-field">
                subject รวมคำ
                <textarea
                  rows={2}
                  value={rule.subjectIncludes.join(", ")}
                  onChange={(e) => updateRuleList(ch, "subjectIncludes", e.target.value)}
                />
              </label>
            </div>
          );
        })}
        <button
          type="button"
          className="primary-btn"
          disabled={busy !== null}
          onClick={() => void onSaveMailRules()}
        >
          บันทึกกฎค้นหา
        </button>
      </section>

      <section className="vat-sales-settings">
        <h2 className="vat-sales-section-title">ลบ raw เมลเก่า</h2>
        <p className="muted vat-sales-hint">
          เก็บหัวข้อ / parsed / สถานะ · ลบเฉพาะเนื้อหา raw ที่เก่ากว่า N เดือน (เจ้าของกดเอง)
        </p>
        <div className="vat-sales-toolbar">
          <label className="vat-sales-month">
            เดือน
            <select value={pruneMonths} onChange={(e) => setPruneMonths(e.target.value)}>
              <option value="6">6</option>
              <option value="12">12</option>
              <option value="18">18</option>
              <option value="24">24</option>
            </select>
          </label>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== null}
            onClick={() => void runPruneRaw(true)}
          >
            {busy === "mail-prune-dry" ? "กำลังตรวจ..." : "ตรวจจำนวน"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== null}
            onClick={() => void runPruneRaw(false)}
          >
            {busy === "mail-prune" ? "กำลังลบ..." : "ลบ raw เก่า"}
          </button>
        </div>
      </section>
      </>
      ) : null}

      <section>
        <div className="vat-sales-toolbar" style={{ marginBottom: "0.65rem" }}>
          <label className="vat-sales-field">
            ช่องทาง
            <select
              value={channelFilter}
              onChange={(e) =>
                setChannelFilter(e.target.value as typeof channelFilter)
              }
            >
              <option value="all">ทั้งหมด</option>
              {DELIVERY_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {DELIVERY_CHANNEL_LABELS[ch]}
                </option>
              ))}
              <option value="unknown">ไม่ทราบช่องทาง</option>
            </select>
          </label>
          <label className="vat-sales-field">
            สถานะ
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="all">ทั้งหมด</option>
              <option value="pending">รอ parse</option>
              <option value="ignored">ข้าม</option>
              <option value="ok">รอตรวจ</option>
              <option value="fail">parse ไม่ผ่าน</option>
              <option value="confirmed">ยืนยันแล้ว</option>
            </select>
          </label>
        </div>

        {loading ? (
          <p className="muted">กำลังโหลดกล่องเมล...</p>
        ) : reports.length === 0 ? (
          <p className="muted">ยังไม่มีเมลในกล่อง — เชื่อม Gmail / Gmail LINE MAN แล้วกดซิงก์</p>
        ) : (
          <div className="sheet-wrap vat-sales-scroll">
            <table className="sheet-table vat-sales-table vat-mail-table">
              <thead>
                <tr>
                  <th>รับ</th>
                  <th>ช่อง</th>
                  <th>ชนิด</th>
                  <th>วัน</th>
                  <th>ยอด</th>
                  <th>หัวข้อ</th>
                  <th>สถานะ</th>
                  <th className="col-act">…</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const kind = r.parsed?.reportKind || r.reportKind || "daily";
                  return (
                  <tr key={r.id}>
                    <td className="col-date">{formatDateTimeShort(r.receivedAt)}</td>
                    <td>
                      {channelReportLabel(r.channel)}
                      {r.provider ? (
                        <div className="muted vat-sales-src">{r.provider}</div>
                      ) : null}
                    </td>
                    <td>{reportKindLabel(kind)}</td>
                    <td>{r.parsed?.reportDate || r.reportDateGuess || "—"}</td>
                    <td className="col-num">
                      {r.parsed ? formatPlainNumber(r.parsed.grossInclusive) : "—"}
                    </td>
                    <td className="col-desc">
                      <div>{r.subject || "(ไม่มีหัวข้อ)"}</div>
                      <div className="muted vat-sales-src">{r.from}</div>
                    </td>
                    <td>
                      <span
                        className={
                          r.parseStatus === "ok" || r.parseStatus === "confirmed"
                            ? "vat-sales-badge ok"
                            : "vat-sales-badge draft"
                        }
                      >
                        {parseStatusLabel(r.parseStatus)}
                      </span>
                    </td>
                    <td className="col-act">
                      <div className="vat-sales-acts">
                        <button
                          type="button"
                          className="ghost-btn vat-sales-act-btn"
                          onClick={() => openReport(r)}
                        >
                          {openId === r.id ? "ปิด" : "ดู/ตรวจ"}
                        </button>
                        {r.parseStatus === "pending" || r.parseStatus === "fail" ? (
                          <button
                            type="button"
                            className="ghost-btn vat-sales-act-btn"
                            disabled={busy !== null}
                            onClick={() => void parseOne(r)}
                          >
                            Parse
                          </button>
                        ) : null}
                        {r.parseStatus !== "ignored" && r.parseStatus !== "confirmed" ? (
                          <button
                            type="button"
                            className="ghost-btn vat-sales-act-btn"
                            disabled={busy !== null}
                            onClick={() => {
                              void (async () => {
                                setBusy(r.id);
                                try {
                                  await setPlatformEmailIgnored(r.id, true);
                                  await refresh();
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : String(e));
                                } finally {
                                  setBusy(null);
                                }
                              })();
                            }}
                          >
                            ข้าม
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

        {open ? (
          <div className="vat-mail-preview">
            <h3 className="vat-sales-section-title">{open.subject || "(ไม่มีหัวข้อ)"}</h3>
            <p className="muted">
              {open.from} · {formatDateTimeShort(open.receivedAt)} ·{" "}
              {channelReportLabel(open.channel)}
              {" · "}
              {reportKindLabel(open.parsed?.reportKind || open.reportKind || "daily")}
              {open.provider ? ` · ${open.provider}` : ""}
              {open.parserVersion ? ` · ${open.parserVersion}` : ""}
            </p>
            {open.parseStatus === "fail" ? (
              <p className="error-text">{open.parseError || "parse ไม่ผ่าน"}</p>
            ) : null}
            {open.parsed?.warnings?.length ? (
              <p className="muted">คำเตือน: {open.parsed.warnings.join(" · ")}</p>
            ) : null}

            {(open.parsed?.reportKind || open.reportKind) === "weekly" ||
            (open.parsed?.reportKind || open.reportKind) === "monthly" ? (
              <p className="muted">
                เมลสรุป{(open.parsed?.reportKind || open.reportKind) === "weekly" ? "สัปดาห์" : "เดือน"} —
                ไม่ใส่ตารางรายวัน · ไปแท็บ <strong>เทียบยอด</strong>
              </p>
            ) : null}

            {review &&
            open.parseStatus !== "confirmed" &&
            (open.parsed?.reportKind || open.reportKind || "daily") === "daily" ? (
              <div className="vat-mail-review">
                <label className="vat-sales-field">
                  วันที่รายงาน
                  <input
                    value={review.reportDate}
                    onChange={(e) => setReview({ ...review, reportDate: e.target.value })}
                  />
                </label>
                <label className="vat-sales-field">
                  ยอดลูกค้า (รวม VAT)
                  <input
                    inputMode="decimal"
                    value={review.grossInclusive}
                    onChange={(e) =>
                      setReview({ ...review, grossInclusive: e.target.value })
                    }
                  />
                </label>
                <label className="vat-sales-field">
                  ค่าธรรมเนียม
                  <input
                    inputMode="decimal"
                    value={review.fee}
                    onChange={(e) => setReview({ ...review, fee: e.target.value })}
                  />
                </label>
                <label className="vat-sales-field">
                  ยอดโอนสุทธิ
                  <input
                    inputMode="decimal"
                    value={review.netTransfer}
                    onChange={(e) =>
                      setReview({ ...review, netTransfer: e.target.value })
                    }
                  />
                </label>
                <div className="vat-sales-acts">
                  {open.channel !== "unknown" ? (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={busy !== null}
                      onClick={() => void confirmOne(open, false)}
                    >
                      ยืนยันเข้าตารางรายวัน
                    </button>
                  ) : null}
                  {open.parseStatus === "fail" || !open.parsed ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy !== null}
                      onClick={() => void parseOne(open)}
                    >
                      Parse อีกครั้ง
                    </button>
                  ) : null}
                </div>
                <p className="muted">
                  ยืนยันเฉพาะช่องทางนี้เข้าตาราง · ไม่ปิดวันอัตโนมัติ · ไม่ทับวันที่ยืนยันแล้ว
                </p>
              </div>
            ) : null}

            {open.parseStatus === "confirmed" ? (
              <p className="muted">ยืนยันเข้าตารางแล้ว</p>
            ) : null}

            <pre className="vat-mail-raw">
              {(open.rawText || open.snippet || "(ไม่มีข้อความ)").slice(0, 8000)}
            </pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
