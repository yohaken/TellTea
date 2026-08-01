"use client";

/**
 * ศึกษาเมล Gmail บนหน้าที่มายอดเดลิเวอรี่
 * — เชื่อมครั้งเดียว · ตารางเมล · แท็กศึกษา (รายวัน / สรุปเดือน · excel/pdf)
 * — ยังไม่ผสานเข้ายอดเดลิเวอรี่จนกว่าจะจูนแล้ว
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeShort } from "@/lib/utils";
import {
  loadVatSalesSettings,
  saveVatSalesSettings,
  type DeliveryChannel,
  type VatMailRules,
} from "@/lib/vat-sales";
import {
  channelReportLabel,
  disconnectVatMail,
  fetchVatMailStatus,
  inferMailStudyHints,
  listPlatformEmailReports,
  loadVatMailOAuthConfig,
  MAIL_STUDY_TAG_PRESETS,
  saveVatMailOAuthConfig,
  startVatMailOAuth,
  syncVatMail,
  togglePlatformEmailStudyTag,
  type PlatformEmailReport,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";
import {
  defaultVatMailStudyNotesText,
  loadVatMailStudyNotes,
  refreshVatMailStudyNotesFromReports,
} from "@/lib/vat-mail-study-notes";

const DEFAULT_REDIRECT =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/vatMailOAuthCallback";

const SOURCES_RETURN =
  "https://telltea-shop.web.app/vat-sales/sources/?mail=connected";

function grainLabel(g: string) {
  if (g === "monthly") return "สรุปเดือน";
  if (g === "weekly") return "สัปดาห์";
  if (g === "daily") return "รายวัน";
  return "—";
}

function fileLabel(kinds: string[]) {
  const k = kinds.filter((x) => x !== "unknown");
  if (!k.length) return "—";
  return k.join("/");
}

type Props = { actor: string };

export function VatMailStudyPanel({ actor }: Props) {
  const [status, setStatus] = useState<VatMailStatus | null>(null);
  const [reports, setReports] = useState<PlatformEmailReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [channelFilter, setChannelFilter] = useState<
    "all" | DeliveryChannel | "unknown"
  >("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [showConfig, setShowConfig] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [cfgClientId, setCfgClientId] = useState("");
  const [cfgSecret, setCfgSecret] = useState("");
  const [cfgRedirect, setCfgRedirect] = useState(DEFAULT_REDIRECT);
  const [hasSecret, setHasSecret] = useState(false);
  const [mailRules, setMailRules] = useState<VatMailRules | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [studyNotes, setStudyNotes] = useState(defaultVatMailStudyNotesText());
  const [notesUpdatedAt, setNotesUpdatedAt] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [st, rows, cfg, settings, notes] = await Promise.all([
        fetchVatMailStatus(),
        listPlatformEmailReports({ channel: channelFilter, max: 120 }),
        loadVatMailOAuthConfig().catch(() => null),
        loadVatSalesSettings().catch(() => null),
        loadVatMailStudyNotes().catch(() => null),
      ]);
      setStatus(st);
      setReports(rows);
      if (cfg) {
        setCfgClientId(cfg.clientId);
        setCfgRedirect(cfg.redirectUri || DEFAULT_REDIRECT);
        setHasSecret(cfg.hasSecret);
      }
      if (settings) setMailRules(settings.mailRules);
      if (notes) {
        setStudyNotes(notes.text);
        setNotesUpdatedAt(notes.updatedAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [channelFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("mail") === "connected") {
      setMsg("เชื่อม Gmail สำเร็จ");
      window.history.replaceState({}, "", "/vat-sales/sources/");
      void refresh();
    }
  }, [refresh]);

  const visible = useMemo(() => {
    if (tagFilter === "all") return reports;
    return reports.filter((r) => r.studyTags.includes(tagFilter));
  }, [reports, tagFilter]);

  const connect = async () => {
    setBusy("connect");
    setError("");
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/vat-sales/sources/?mail=connected`
          : SOURCES_RETURN;
      const url = await startVatMailOAuth(returnTo);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("ตัดการเชื่อม Gmail?")) return;
    setBusy("disconnect");
    try {
      await disconnectVatMail();
      setMsg("ตัดการเชื่อม Gmail แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const sync = async () => {
    setBusy("sync");
    setError("");
    setMsg("");
    try {
      const res = await syncVatMail(45);
      const rows = await listPlatformEmailReports({
        channel: channelFilter,
        max: 120,
      });
      setReports(rows);
      try {
        const notes = await refreshVatMailStudyNotesFromReports(rows, actor);
        setStudyNotes(notes.text);
        setNotesUpdatedAt(notes.updatedAt);
      } catch {
        /* บันทึก AI ไม่บล็อกซิงก์ */
      }
      setMsg(
        `ซิงก์แล้ว · สแกน ${res.scanned} · เพิ่ม ${res.added} · ข้ามซ้ำ ${res.skipped}` +
          (res.pdfEnriched ? ` · PDF ${res.pdfEnriched}` : "") +
          " · อัปเดตบันทึก AI แล้ว",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const updateAiNotes = async () => {
    setBusy("notes");
    setError("");
    try {
      const notes = await refreshVatMailStudyNotesFromReports(reports, actor);
      setStudyNotes(notes.text);
      setNotesUpdatedAt(notes.updatedAt);
      setMsg(`อัปเดตบันทึก AI แล้ว · ${notes.reportCount} ฉบับ`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const saveConfig = async () => {
    setBusy("cfg");
    setError("");
    try {
      await saveVatMailOAuthConfig({
        clientId: cfgClientId,
        clientSecret: cfgSecret,
        redirectUri: cfgRedirect || DEFAULT_REDIRECT,
        updatedBy: actor,
      });
      setCfgSecret("");
      setHasSecret(true);
      setMsg("บันทึก Client ID/Secret แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const saveRules = async () => {
    if (!mailRules) return;
    setBusy("rules");
    setError("");
    try {
      await saveVatSalesSettings({ mailRules }, actor);
      setMsg("บันทึกกฎคัดเมลแล้ว · ซิงก์รอบถัดไปจะใช้กฎนี้");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const onToggleTag = async (r: PlatformEmailReport, tag: string) => {
    try {
      const next = await togglePlatformEmailStudyTag(r.id, r.studyTags, tag);
      setReports((rows) =>
        rows.map((x) => (x.id === r.id ? { ...x, studyTags: next } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <section className="vat-table-block vat-mail-study" aria-label="ศึกษาเมล">
      <h3 className="vat-table-subtitle">ศึกษาเมล Gmail</h3>
      <p className="muted vat-sales-hint">
        บางแอพส่งไฟล์รายวัน · บางแอพสรุปทั้งเดือน (Excel / PDF) ·
        ติดแท็กศึกษาบนตาราง แล้วค่อยจูนกับ AI — ยังไม่เข้างบ
      </p>

      <div className="vat-mail-study-toolbar">
        <span className="vat-mail-study-status" title={status?.email || ""}>
          {connected
            ? `เชื่อมแล้ว · ${status?.email || "Gmail"}`
            : status?.hasConfig
              ? "ยังไม่เชื่อม"
              : "ยังไม่มี Client ID"}
        </span>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busy)}
          onClick={() => setShowConfig((v) => !v)}
        >
          {showConfig ? "ปิดค่า" : "ตั้งค่า"}
        </button>
        {connected ? (
          <>
            <button
              type="button"
              className="vat-mini-btn vat-mini-btn--primary"
              disabled={Boolean(busy)}
              onClick={() => void sync()}
            >
              {busy === "sync" ? "ซิงก์…" : "ซิงก์เมล"}
            </button>
            <button
              type="button"
              className="vat-mini-btn"
              disabled={Boolean(busy)}
              onClick={() => void disconnect()}
            >
              ตัด
            </button>
          </>
        ) : (
          <button
            type="button"
            className="vat-mini-btn vat-mini-btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void connect()}
          >
            {busy === "connect" ? "เปิด Google…" : "เชื่อม Gmail"}
          </button>
        )}
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busy)}
          onClick={() => setShowRules((v) => !v)}
        >
          {showRules ? "ปิดกฎคัด" : "กฎคัดเมล"}
        </button>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={Boolean(busy) || loading}
          title="เขียนแคตตาล็อกเมลลงบันทึกให้ AI อ่าน"
          onClick={() => void updateAiNotes()}
        >
          {busy === "notes" ? "บันทึก…" : "อัปเดตบันทึก AI"}
        </button>
      </div>

      <aside
        className="vat-mail-study-notes"
        data-ai-context="vat-mail-study-notes"
        aria-label="บันทึกศึกษาเมลสำหรับ AI"
      >
        <pre
          id="vat-mail-study-notes"
          className="vat-mail-study-notes-body"
          data-ai-notes="1"
        >
          {studyNotes || defaultVatMailStudyNotesText()}
        </pre>
        <p className="muted vat-sales-hint vat-hint-one-line">
          บันทึก AI · อ่านจาก #vat-mail-study-notes
          {notesUpdatedAt
            ? ` · ${new Date(notesUpdatedAt).toLocaleString("th-TH")}`
            : " · ยังไม่เคยอัปเดต"}
        </p>
      </aside>

      {showConfig ? (
        <div className="vat-mail-study-config">
          <p className="muted vat-sales-hint vat-hint-one-line">
            ตั้งครั้งเดียว · Redirect = {DEFAULT_REDIRECT}
          </p>
          <label className="vat-mail-study-field">
            Client ID
            <input
              value={cfgClientId}
              onChange={(e) => setCfgClientId(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="vat-mail-study-field">
            Client Secret {hasSecret ? "(มีแล้ว · ใส่ใหม่ถ้าจะเปลี่ยน)" : ""}
            <input
              type="password"
              value={cfgSecret}
              onChange={(e) => setCfgSecret(e.target.value)}
              autoComplete="off"
              placeholder={hasSecret ? "••••••••" : ""}
            />
          </label>
          <label className="vat-mail-study-field">
            Redirect URI
            <input
              value={cfgRedirect}
              onChange={(e) => setCfgRedirect(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="vat-mini-btn vat-mini-btn--primary"
            disabled={Boolean(busy) || !cfgClientId.trim()}
            onClick={() => void saveConfig()}
          >
            บันทึก Gmail
          </button>
        </div>
      ) : null}

      {showRules && mailRules ? (
        <div className="vat-mail-study-rules">
          <p className="muted vat-sales-hint">
            คำใน From / Subject คั่นด้วยจุลภาค — ใช้ตอนซิงก์คัดเมลเข้าตาราง
          </p>
          {(["shopee", "grab", "lineman"] as const).map((ch) => (
            <div key={ch} className="vat-mail-study-rule-row">
              <strong>{channelReportLabel(ch)}</strong>
              <label>
                From
                <input
                  value={mailRules[ch].fromIncludes.join(", ")}
                  onChange={(e) =>
                    setMailRules({
                      ...mailRules,
                      [ch]: {
                        ...mailRules[ch],
                        fromIncludes: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </label>
              <label>
                Subject รวม
                <input
                  value={mailRules[ch].subjectIncludes.join(", ")}
                  onChange={(e) =>
                    setMailRules({
                      ...mailRules,
                      [ch]: {
                        ...mailRules[ch],
                        subjectIncludes: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            className="vat-mini-btn vat-mini-btn--primary"
            disabled={Boolean(busy)}
            onClick={() => void saveRules()}
          >
            บันทึกกฎคัด
          </button>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      <div className="vat-mail-study-filters">
        <label>
          ช่องทาง
          <select
            value={channelFilter}
            onChange={(e) =>
              setChannelFilter(
                e.target.value as "all" | DeliveryChannel | "unknown",
              )
            }
          >
            <option value="all">ทั้งหมด</option>
            <option value="grab">Grab</option>
            <option value="lineman">LINE MAN</option>
            <option value="shopee">Shopee</option>
            <option value="unknown">ไม่ทราบ</option>
          </select>
        </label>
        <label>
          แท็ก
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="all">ทั้งหมด</option>
            {MAIL_STUDY_TAG_PRESETS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="vat-mini-btn"
          disabled={loading || Boolean(busy)}
          onClick={() => void refresh()}
        >
          รีเฟรช
        </button>
      </div>

      {loading ? (
        <p className="muted">กำลังโหลดเมล…</p>
      ) : (
        <div className="sheet-wrap vat-month-slim-wrap">
          <table className="sheet-table vat-sales-table vat-sales-table--slim vat-mail-study-table">
            <thead>
              <tr>
                <th className="col-date">รับเมื่อ</th>
                <th className="col-seg">ช่อง</th>
                <th className="col-seg">ช่วง</th>
                <th className="col-seg">ไฟล์</th>
                <th className="col-desc">หัวข้อ</th>
                <th className="col-desc">แท็กศึกษา</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {connected
                      ? "ยังไม่มีเมลในตาราง — กดซิงก์ หรือปรับกฎคัด"
                      : "เชื่อม Gmail แล้วซิงก์เพื่อดึงเมลมาศึกษา"}
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const hints = inferMailStudyHints(r);
                  const open = openId === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={open ? "is-open" : undefined}
                      onClick={() => setOpenId(open ? null : r.id)}
                    >
                      <td className="col-date">
                        {r.receivedAt
                          ? formatDateTimeShort(r.receivedAt)
                          : "—"}
                      </td>
                      <td className="col-seg">
                        {channelReportLabel(r.channel)}
                      </td>
                      <td className="col-seg" title={r.reportKind}>
                        {grainLabel(hints.grain)}
                      </td>
                      <td
                        className="col-seg"
                        title={(r.pdfFilenames || []).join(", ")}
                      >
                        {fileLabel(hints.fileKinds)}
                      </td>
                      <td className="col-desc" title={r.from}>
                        <div className="vat-mail-subject">{r.subject || "—"}</div>
                        {open ? (
                          <div className="muted vat-mail-study-snippet">
                            {r.from}
                            {r.snippet ? ` · ${r.snippet}` : ""}
                            {r.pdfFilenames?.length
                              ? ` · ไฟล์: ${r.pdfFilenames.join(", ")}`
                              : ""}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="col-desc"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="vat-mail-study-tags">
                          {MAIL_STUDY_TAG_PRESETS.map((t) => {
                            const on = r.studyTags.includes(t);
                            return (
                              <button
                                key={t}
                                type="button"
                                className={
                                  on
                                    ? "vat-tag-chip is-on"
                                    : "vat-tag-chip"
                                }
                                onClick={() => void onToggleTag(r, t)}
                              >
                                {t}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
