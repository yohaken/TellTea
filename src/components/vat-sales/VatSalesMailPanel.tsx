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
  reparsePendingPlatformEmails,
  reparsePlatformEmailReport,
  saveVatMailOAuthConfig,
  setPlatformEmailIgnored,
  startVatMailOAuth,
  syncVatMail,
  type MailParseStatus,
  type PlatformEmailReport,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";

const DEFAULT_REDIRECT =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/vatMailOAuthCallback";

type Props = {
  actor: string;
  settings: VatSalesSettings;
  onSettingsChange: (next: VatSalesSettings) => void;
  onSaveMailRules: () => Promise<void>;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string) => void;
  setMsg: (v: string) => void;
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
}: Props) {
  const [status, setStatus] = useState<VatMailStatus | null>(null);
  const [reports, setReports] = useState<PlatformEmailReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<"all" | DeliveryChannel | "unknown">(
    "all",
  );
  const [statusFilter, setStatusFilter] = useState<MailParseStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [cfgClientId, setCfgClientId] = useState("");
  const [cfgSecret, setCfgSecret] = useState("");
  const [cfgRedirect, setCfgRedirect] = useState(DEFAULT_REDIRECT);
  const [hasSecret, setHasSecret] = useState(false);
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
      const [st, rows, cfg] = await Promise.all([
        fetchVatMailStatus(),
        listPlatformEmailReports({
          channel: channelFilter,
          parseStatus: statusFilter,
          max: 80,
        }),
        loadVatMailOAuthConfig().catch(() => null),
      ]);
      setStatus(st);
      setReports(rows);
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
  }, [channelFilter, statusFilter, setError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async () => {
    setBusy("mail-connect");
    setError("");
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/vat-sales/?tab=mail`
          : "https://mypeer-501909.web.app/vat-sales/?tab=mail";
      const url = await startVatMailOAuth(returnTo);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("ตัดการเชื่อม Gmail?")) return;
    setBusy("mail-disconnect");
    setError("");
    try {
      await disconnectVatMail();
      setMsg("ตัดการเชื่อม Gmail แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("mail-sync");
    setError("");
    setMsg("");
    try {
      const res = await syncVatMail(31);
      setMsg(`ซิงก์แล้ว · สแกน ${res.scanned} · เพิ่ม ${res.added} · ข้ามซ้ำ ${res.skipped}`);
      await refresh();
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
        redirectUri: cfgRedirect,
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
    <div className="vat-mail-panel">
      <section className="vat-sales-settings">
        <h2 className="vat-sales-section-title">เชื่อม Gmail</h2>
        <p className="muted vat-sales-hint">
          อ่านเมลอย่างเดียว · token เก็บบนเซิร์ฟเวอร์ · พนักงานเข้าถึงไม่ได้
        </p>
        {status ? (
          <div className="vat-mail-status">
            <div>
              สถานะ:{" "}
              <strong>
                {status.connected ? `เชื่อมแล้ว (${status.email || "gmail"})` : "ยังไม่เชื่อม"}
              </strong>
            </div>
            <div className="muted">
              OAuth config: {status.hasConfig ? "พร้อม" : "ยังไม่ครบ"}
              {status.lastSyncAt
                ? ` · ซิงก์ล่าสุด ${formatDateTimeShort(status.lastSyncAt)}`
                : ""}
            </div>
            {status.lastSyncError ? (
              <p className="error-text">ซิงก์ล่าสุดพลาด: {status.lastSyncError}</p>
            ) : null}
          </div>
        ) : null}
        <div className="vat-sales-toolbar">
          {!status?.connected ? (
            <button
              type="button"
              className="primary-btn"
              disabled={busy !== null}
              onClick={() => void connect()}
            >
              เชื่อม Gmail
            </button>
          ) : (
            <>
              <button
                type="button"
                className="primary-btn"
                disabled={busy !== null}
                onClick={() => void sync()}
              >
                {busy === "mail-sync" ? "กำลังซิงก์..." : "ซิงก์เมลตอนนี้"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                ตัดการเชื่อม
              </button>
            </>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setShowConfig((v) => !v)}
          >
            {showConfig ? "ซ่อน OAuth config" : "ตั้งค่า OAuth"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={busy !== null || loading}
            onClick={() => void refresh()}
          >
            รีเฟรชกล่องเมล
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void runParsePending()}
          >
            {busy === "mail-parse" ? "กำลัง parse..." : "Parse เมลที่รอ"}
          </button>
        </div>

        {showConfig ? (
          <div className="vat-mail-config">
            <p className="muted">
              ใส่ Google OAuth Client (Web) · Redirect URI ต้องชี้ไป Cloud Function{" "}
              <code>vatMailOAuthCallback</code>
            </p>
            <label className="vat-sales-field">
              Client ID
              <input
                value={cfgClientId}
                onChange={(e) => setCfgClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="vat-sales-field">
              Client Secret {hasSecret ? "(มีอยู่แล้ว — ใส่ใหม่เมื่อจะเปลี่ยน)" : ""}
              <input
                type="password"
                value={cfgSecret}
                onChange={(e) => setCfgSecret(e.target.value)}
                autoComplete="off"
                placeholder={hasSecret ? "••••••" : ""}
              />
            </label>
            <label className="vat-sales-field">
              Redirect URI
              <input
                value={cfgRedirect}
                onChange={(e) => setCfgRedirect(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="primary-btn"
              disabled={busy !== null}
              onClick={() => void saveConfig()}
            >
              บันทึก OAuth config
            </button>
          </div>
        ) : null}
      </section>

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
          <p className="muted">ยังไม่มีเมลในกล่อง — เชื่อม Gmail แล้วกดซิงก์</p>
        ) : (
          <div className="sheet-wrap vat-sales-scroll">
            <table className="sheet-table vat-sales-table vat-mail-table">
              <thead>
                <tr>
                  <th>รับเมื่อ</th>
                  <th>ช่องทาง</th>
                  <th>วันรายงาน</th>
                  <th>ยอดลูกค้า</th>
                  <th>หัวข้อ</th>
                  <th>สถานะ</th>
                  <th className="col-act">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="col-date">{formatDateTimeShort(r.receivedAt)}</td>
                    <td>{channelReportLabel(r.channel)}</td>
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
                ))}
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
              {open.parserVersion ? ` · ${open.parserVersion}` : ""}
            </p>
            {open.parseStatus === "fail" ? (
              <p className="error-text">{open.parseError || "parse ไม่ผ่าน"}</p>
            ) : null}
            {open.parsed?.warnings?.length ? (
              <p className="muted">คำเตือน: {open.parsed.warnings.join(" · ")}</p>
            ) : null}

            {review && open.parseStatus !== "confirmed" ? (
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
