"use client";

/**
 * ช่องไฟล์ Drive — F0–F5
 * ระบบ/AI เติมยอด (รายวัน 4 คอลัมน์) · owner ซุ่มตรวจแล้วยืนยัน F5
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MONTH_CHANNEL_LABEL, MONTH_CHANNELS } from "@/lib/vat-month-sources";
import { formatThaiDateKey, formatThaiMonthKey } from "@/lib/vat-monthly";
import { formatVatMoney } from "@/lib/vat-number-format";
import type { MonthChannel } from "@/lib/vat-month-books";
import {
  classifyVatMailPeriods,
  disconnectVatMail,
  fetchVatMailStatus,
  listMonthDriveFiles,
  startVatMailOAuth,
  syncVatMail,
  syncVatMailDrive,
  type VatMailDriveFile,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";
import {
  channelHasConfirmableAmounts,
  draftDriveMonthProposal,
  loadMonthProposal,
  mergeProposalIntoBooks,
  sortedChannelDays,
  type VatDeliveryMonthProposal,
} from "@/lib/vat-delivery-month-proposals";
import {
  buildChannelDeliveryChecks,
  summarizeChannelChecks,
} from "@/lib/vat-delivery-checks";

type Props = {
  monthKey: string;
  actor: string;
  onBooksMerged?: () => void;
};

const SOURCES_RETURN =
  "https://telltea-shop.web.app/vat-sales/sources/?mail=connected";

const CHANNEL_FOLDER: Record<MonthChannel, string> = {
  grab: "grab",
  lineman: "lineman",
  shopee: "shopee",
};

type CheckId = "f0" | "f1" | "f2" | "f3" | "f4" | "f5";

function emptyByChannel(): Record<MonthChannel, VatMailDriveFile[]> {
  return { grab: [], lineman: [], shopee: [] };
}

function fmtAmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return formatVatMoney(Number(n));
}

export function VatSourcesDriveSlot({
  monthKey,
  actor,
  onBooksMerged,
}: Props) {
  const [status, setStatus] = useState<VatMailStatus | null>(null);
  const [files, setFiles] = useState<Record<MonthChannel, VatMailDriveFile[]>>(
    () => emptyByChannel(),
  );
  const [fileTotal, setFileTotal] = useState(0);
  const [proposal, setProposal] = useState<VatDeliveryMonthProposal | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [st, listed, prop] = await Promise.all([
        fetchVatMailStatus(),
        listMonthDriveFiles(monthKey),
        loadMonthProposal(monthKey),
      ]);
      setStatus(st);
      setFiles(listed.byChannel);
      setFileTotal(listed.total);
      setProposal(prop);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const drive = status?.drive;
  const hasDriveScope = Boolean(status?.hasDriveScope || drive?.hasDriveScope);
  const rootFolderId = String(drive?.rootFolderId || "");
  const f0Ready = Boolean(status?.connected && hasDriveScope && rootFolderId);
  const f1Ready = fileTotal > 0 || Number(drive?.lastDriveSyncUploaded) > 0;
  const f2Ready = true;
  const f3Ready = true;
  const f4Ready = Boolean(
    proposal &&
      MONTH_CHANNELS.some((ch) =>
        channelHasConfirmableAmounts(proposal.channels[ch]),
      ),
  );
  const f5Ready = proposal?.status === "merged";

  const checks = useMemo(
    () =>
      [
        {
          id: "f0" as CheckId,
          label: "OAuth + scope Drive · ราก TellTea-VAT",
          ready: f0Ready,
        },
        {
          id: "f1" as CheckId,
          label: "ซิงก์แนบเมล → Drive กองรวมต่อแอพ",
          ready: f1Ready,
        },
        {
          id: "f2" as CheckId,
          label: "รายการไฟล์บนหน้านี้ + เปิดลิงก์",
          ready: f2Ready,
        },
        {
          id: "f3" as CheckId,
          label: "Agent Dump ส่งลิงก์ไฟล์ให้ AI",
          ready: f3Ready,
        },
        {
          id: "f4" as CheckId,
          label: "AI/ร่างยอดจากไฟล์ → ข้อเสนอเดือน",
          ready: f4Ready,
        },
        {
          id: "f5" as CheckId,
          label: "Owner ยืนยัน → ลงตารางยอดเดลิเวอรี่",
          ready: f5Ready,
        },
      ] as const,
    [f0Ready, f1Ready, f2Ready, f3Ready, f4Ready, f5Ready],
  );

  const readyCount = checks.filter((c) => c.ready).length;
  const confirmableChannels = MONTH_CHANNELS.filter((ch) =>
    channelHasConfirmableAmounts(proposal?.channels[ch]),
  );

  const channelCheckMap = useMemo(() => {
    const out = {} as Record<
      MonthChannel,
      ReturnType<typeof buildChannelDeliveryChecks>
    >;
    for (const ch of MONTH_CHANNELS) {
      out[ch] = buildChannelDeliveryChecks({
        monthKey,
        channel: ch,
        proposal: proposal?.channels[ch],
        fileCount: (files[ch] || []).length,
      });
    }
    return out;
  }, [monthKey, proposal, files]);

  async function onConnect() {
    setBusy("oauth");
    setError("");
    setMsg("");
    try {
      const url = await startVatMailOAuth(SOURCES_RETURN);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  async function onDisconnect() {
    if (!window.confirm("ตัดเชื่อม Gmail? ต้องเชื่อมใหม่เพื่อรับสิทธิ์ Drive")) {
      return;
    }
    setBusy("disconnect");
    setError("");
    setMsg("");
    try {
      await disconnectVatMail();
      setMsg("ตัดเชื่อมแล้ว — กดเชื่อม Gmail (+Drive) อีกครั้ง");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onSyncMail() {
    setBusy("mail");
    setError("");
    setMsg("");
    try {
      // ย้อนหลายหน้า Gmail (~4 เดือน) · รวมคาบเกี่ยวต้น/ปลายเดือน
      const r = await syncVatMail(120);
      setMsg(
        `ซิงก์เมลแล้ว · ใหม่ ${r.added} · ข้าม ${r.skipped}` +
          (r.pdfEnriched ? ` · PDF ${r.pdfEnriched}` : ""),
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onSyncDrive() {
    setBusy("drive");
    setError("");
    setMsg("");
    try {
      // กองรวมต่อแอพ — ไม่กรองเดือน (ไฟล์ใหม่อยู่ TellTea-VAT/{แอพ}/)
      const r = await syncVatMailDrive();
      const errHint = r.errors?.length ? ` · เตือน: ${r.errors[0]}` : "";
      setMsg(
        `Drive · อัป ${r.uploaded} ไฟล์ · สแกน ${r.scanned}` +
          (r.rootCreated ? " · สร้าง TellTea-VAT" : "") +
          " · กองรวมต่อแอพ" +
          errHint,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onClassifyPeriod() {
    setBusy("period");
    setError("");
    setMsg("");
    try {
      const r = await classifyVatMailPeriods({ monthKey, limit: 30 });
      setMsg(
        `คัดแยกเดือนแล้ว · อัปเดต ${r.updated}` +
          (r.aiCalled ? ` · Gemini ${r.aiCalled}` : ` · heuristic ${r.heuristicOnly}`) +
          " · แล้วซิงก์ Drive ใหม่ได้",
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onDraftF4() {
    setBusy("draft");
    setError("");
    setMsg("");
    try {
      const p = await draftDriveMonthProposal({ monthKey, actor });
      setProposal(p);
      const n = MONTH_CHANNELS.filter((ch) =>
        channelHasConfirmableAmounts(p.channels[ch]),
      ).length;
      setMsg(
        n
          ? `F4 ร่างยอดแล้ว ${n} ช่อง · ยังไม่ทับงบ — กดยืนยัน F5`
          : "F4 ยังไม่มียอดจากไฟล์/เมล — ซิงก์ Drive หรือให้ AI ยิง propose",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function onConfirmF5(channels?: MonthChannel[]) {
    setBusy("confirm");
    setError("");
    setMsg("");
    try {
      const r = await mergeProposalIntoBooks({
        monthKey,
        actor,
        proposal: proposal || undefined,
        channels,
      });
      if (r.skipped) {
        setMsg(r.reason || "ข้ามการผสาน");
        if (r.proposal) setProposal(r.proposal);
        return;
      }
      setProposal(r.proposal);
      setMsg(
        `F5 ผสานงบแล้ว · ${r.mergedChannels
          .map((c) => MONTH_CHANNEL_LABEL[c])
          .join(", ")}`,
      );
      onBooksMerged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const connectLabel =
    !status?.connected
      ? "เชื่อม Gmail (+Drive)"
      : !hasDriveScope
        ? "เชื่อมใหม่ (รับสิทธิ์ Drive)"
        : "เชื่อม Gmail แล้ว";

  return (
    <section
      id="vat-sources-drive-slot"
      className="vat-table-block vat-sources-drive-slot"
      data-ai-context="vat-sources-drive-slot"
      data-drive-ready={String(readyCount)}
      data-month={monthKey}
      aria-label="ช่องไฟล์ Drive — เช็คลิสต์และกล่องแอพ"
    >
      <h3 className="vat-table-subtitle">รางงานแยกแอพ — ไฟล์ · เช็ค · ยอด</h3>
      <p className="muted vat-sales-hint vat-hint-one-line">
        เดือนปิดงบ {formatThaiMonthKey(monthKey)} · แต่ละราง = 1 แอพ (แนวนอน
        เทียบได้) · Drive กองรวม TellTea-VAT/แอพ/ · A สรุปเดือน / B รายวัน
      </p>

      <div className="vat-sources-drive-actions">
        {status?.connected && hasDriveScope ? (
          <button
            type="button"
            className="ghost-btn vat-mini-btn"
            disabled={Boolean(busy)}
            onClick={() => void onDisconnect()}
          >
            ตัดเชื่อม
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn vat-mini-btn"
            disabled={Boolean(busy) || loading}
            onClick={() => void onConnect()}
          >
            {busy === "oauth" ? "กำลังเปิด…" : connectLabel}
          </button>
        )}
        <button
          type="button"
          className="ghost-btn vat-mini-btn"
          disabled={Boolean(busy) || !status?.connected}
          onClick={() => void onSyncMail()}
        >
          {busy === "mail" ? "ซิงก์เมล…" : "ซิงก์เมล"}
        </button>
        <button
          type="button"
          className="primary-btn vat-mini-btn"
          disabled={Boolean(busy) || !status?.connected || !hasDriveScope}
          onClick={() => void onSyncDrive()}
        >
          {busy === "drive" ? "ซิงก์ Drive…" : "ซิงก์ไฟล์ → กองแอพ"}
        </button>
        <button
          type="button"
          className="ghost-btn vat-mini-btn"
          disabled={Boolean(busy) || !status?.connected}
          onClick={() => void onClassifyPeriod()}
        >
          {busy === "period" ? "คัดแยกเดือน…" : "คัดแยกเดือน (เนื้อ+Gemini)"}
        </button>
        <button
          type="button"
          className="ghost-btn vat-mini-btn"
          disabled={Boolean(busy)}
          onClick={() => void onDraftF4()}
        >
          {busy === "draft" ? "ระบบกำลังเติม…" : "ระบบเติมยอด F4"}
        </button>
        <button
          type="button"
          className="primary-btn vat-mini-btn"
          disabled={Boolean(busy) || !confirmableChannels.length}
          onClick={() => void onConfirmF5()}
        >
          {busy === "confirm" ? "กำลังผสาน…" : "ซุ่มตรวจแล้ว · ยืนยัน F5"}
        </button>
        <button
          type="button"
          className="ghost-btn vat-mini-btn"
          disabled={Boolean(busy) || loading}
          onClick={() => void refresh()}
        >
          รีเฟรช
        </button>
        {drive?.rootWebViewLink ? (
          <a
            className="ghost-btn vat-mini-btn"
            href={drive.rootWebViewLink}
            target="_blank"
            rel="noreferrer"
          >
            เปิด TellTea-VAT
          </a>
        ) : null}
      </div>

      {status?.connected ? (
        <p className="muted vat-sources-drive-status-line">
          {status.email || "Gmail"}
          {hasDriveScope ? " · มีสิทธิ์ Drive" : " · ยังไม่มีสิทธิ์ Drive — เชื่อมใหม่"}
          {rootFolderId ? " · มีรากโฟลเดอร์" : " · ยังไม่มีราก (กดซิงก์ Drive)"}
          {proposal
            ? ` · ข้อเสนอ ${proposal.phase}/${proposal.status}`
            : " · ยังไม่มีข้อเสนอเดือน"}
        </p>
      ) : (
        <p className="muted vat-sources-drive-status-line">
          ยังไม่เชื่อม Gmail — ต้องเชื่อมครั้งหนึ่งเพื่อรับสิทธิ์ Drive
        </p>
      )}

      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}

      <ul className="vat-sources-drive-checks" aria-label="เช็คลิสต์ Drive F0–F5">
        {checks.map((c) => (
          <li
            key={c.id}
            className="vat-sources-drive-check"
            data-check={c.id}
            data-ready={c.ready ? "1" : "0"}
          >
            <span className="vat-sources-drive-mark" aria-hidden="true">
              {c.ready ? "✓" : "○"}
            </span>
            <span>
              <span className="vat-sources-drive-phase">{c.id.toUpperCase()}</span>{" "}
              {c.label}
            </span>
            <span className="muted">{c.ready ? "พร้อม" : "ว่าง"}</span>
          </li>
        ))}
      </ul>

      <div
        className="vat-sources-drive-tracks"
        data-drive-files={String(fileTotal)}
        aria-label="รางงานแยกแอพ — เทียบแนวนอน"
      >
        {MONTH_CHANNELS.map((ch) => {
          const folder = `TellTea-VAT/${CHANNEL_FOLDER[ch]}/`;
          const list = files[ch] || [];
          const chProp = proposal?.channels[ch];
          const canConfirm = channelHasConfirmableAmounts(chProp);
          const chChecks = channelCheckMap[ch] || [];
          const chSum = summarizeChannelChecks(chChecks);
          const dayRows = sortedChannelDays(chProp?.days);
          const showDaily =
            dayRows.length > 0 ||
            chProp?.strategy === "daily-rollup" ||
            chProp?.strategy === "mixed" ||
            chProp?.strategy === "unknown" ||
            chProp?.strategy !== "monthly-summary";
          const groupLabel =
            chProp?.strategy === "monthly-summary"
              ? "กลุ่ม A · สรุปเดือน"
              : chProp?.strategy === "daily-rollup" ||
                  chProp?.strategy === "mixed"
                ? "กลุ่ม B · ม้วนรายวัน"
                : "รอจัดกลุ่ม";
          return (
            <article
              key={ch}
              className="vat-sources-drive-track"
              data-channel={ch}
              data-file-count={String(list.length)}
              data-check-ready={`${chSum.ready}/${chSum.applicable}`}
            >
              <header className="vat-sources-drive-track-head">
                <h4 className="vat-sources-drive-box-title">
                  {MONTH_CHANNEL_LABEL[ch]}
                </h4>
                <span className="vat-sources-drive-track-meta">
                  {groupLabel}
                  {" · "}
                  {list.length ? `${list.length} ไฟล์` : "0 ไฟล์"}
                  {" · เช็ค "}
                  <span
                    className={
                      chSum.allOk
                        ? "vat-sources-drive-count"
                        : "vat-sources-drive-empty"
                    }
                  >
                    {chSum.ready}/{chSum.applicable}
                  </span>
                </span>
                <p className="muted vat-sources-drive-path">{folder}</p>
              </header>

              <div className="vat-sources-drive-track-row">
                <section
                  className="vat-sources-drive-track-col vat-sources-drive-track-files"
                  aria-label={`ไฟล์ ${MONTH_CHANNEL_LABEL[ch]}`}
                >
                  <p className="vat-sources-drive-draft-title">ไฟล์กองแอพ</p>
                  <ul className="vat-sources-drive-file-list">
                    {list.length === 0 ? (
                      <li className="muted vat-sources-drive-file-empty">
                        {loading
                          ? "กำลังโหลด…"
                          : "ยังไม่มีไฟล์ — ซิงก์เมล แล้วกด「ซิงก์ไฟล์ → กองแอพ」"}
                      </li>
                    ) : (
                      list.map((f) => (
                        <li key={f.fileId} className="vat-sources-drive-file">
                          {f.webViewLink ? (
                            <a
                              href={f.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="vat-sources-drive-file-link"
                            >
                              {f.name}
                            </a>
                          ) : (
                            <span>{f.name}</span>
                          )}
                          {f.monthKey ? (
                            <span className="muted vat-sources-drive-file-month">
                              {" "}
                              · {f.monthKey}
                            </span>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                </section>

                <section
                  className="vat-sources-drive-track-col vat-sources-drive-track-checks"
                  aria-label={`เช็คลิสต์ ${MONTH_CHANNEL_LABEL[ch]}`}
                >
                  <p className="vat-sources-drive-draft-title">
                    เช็คลิสต์ความถูกต้อง
                  </p>
                  <ul className="vat-sources-drive-verify">
                    {chChecks.map((item) => (
                      <li
                        key={item.id}
                        className="vat-sources-drive-verify-item"
                        data-ok={item.applicable && item.ok ? "1" : "0"}
                        data-na={item.applicable ? "0" : "1"}
                      >
                        <span
                          className="vat-sources-drive-mark"
                          aria-hidden="true"
                        >
                          {!item.applicable ? "·" : item.ok ? "✓" : "○"}
                        </span>
                        <span>
                          {item.label}
                          {item.detail ? (
                            <span className="muted"> — {item.detail}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section
                  className="vat-sources-drive-track-col vat-sources-drive-track-work"
                  aria-label={`ยอด ${MONTH_CHANNEL_LABEL[ch]}`}
                >
                  {showDaily ? (
                    <div
                      className="vat-sources-drive-daily"
                      data-daily={ch}
                      aria-label={`ตารางรายวัน ${MONTH_CHANNEL_LABEL[ch]}`}
                    >
                      <p className="vat-sources-drive-draft-title">
                        ตารางรายวัน · ระบบเติม · ซุ่มตรวจ
                      </p>
                      <div className="sheet-wrap vat-sources-drive-daily-wrap">
                        <table className="sheet-table vat-sales-table vat-sales-table--slim vat-sources-drive-daily-table">
                          <thead>
                            <tr>
                              <th>วันที่</th>
                              <th>ยอดขายแอพ</th>
                              <th>ยอดโอน</th>
                              <th>คชจ.GP</th>
                              <th>VAT-ซื้อ</th>
                              <th>สถานะ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dayRows.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="muted">
                                  {chProp?.strategy === "monthly-summary"
                                    ? "กลุ่ม A ใช้สรุปเดือน — ตารางรายวันเป็นทางเลือกเทียบ"
                                    : "ยังไม่มีแถวรายวัน — กด「ระบบเติมยอด F4」"}
                                </td>
                              </tr>
                            ) : (
                              dayRows.map((d) => (
                                <tr
                                  key={d.dateKey}
                                  data-day={d.dateKey}
                                  data-day-status={d.status}
                                >
                                  <td>{formatThaiDateKey(d.dateKey)}</td>
                                  <td className="col-num">
                                    {fmtAmt(d.appSales)}
                                  </td>
                                  <td className="col-num">
                                    {fmtAmt(d.transfer)}
                                  </td>
                                  <td className="col-num">
                                    {fmtAmt(d.gpExVat)}
                                  </td>
                                  <td className="col-num">
                                    {fmtAmt(d.gpVat)}
                                  </td>
                                  <td>
                                    <span
                                      className={
                                        d.status === "gap"
                                          ? "vat-sources-drive-empty"
                                          : "vat-sources-drive-count"
                                      }
                                    >
                                      {d.status === "gap"
                                        ? "ว่าง"
                                        : d.status === "ซุ่มตรวจ"
                                          ? "ซุ่มตรวจ"
                                          : "เติมแล้ว"}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  <div className="vat-sources-drive-draft" data-draft={ch}>
                    <p className="vat-sources-drive-draft-title">
                      รวมเดือน (4 คอลัมน์)
                    </p>
                    <dl className="vat-sources-drive-draft-grid">
                      <div>
                        <dt>ยอดขายแอพ</dt>
                        <dd>{fmtAmt(chProp?.amounts.appSales)}</dd>
                      </div>
                      <div>
                        <dt>ยอดโอน</dt>
                        <dd>{fmtAmt(chProp?.amounts.transfer)}</dd>
                      </div>
                      <div>
                        <dt>คชจ.GP</dt>
                        <dd>{fmtAmt(chProp?.amounts.gpExVat)}</dd>
                      </div>
                      <div>
                        <dt>VAT-ซื้อ</dt>
                        <dd>{fmtAmt(chProp?.amounts.gpVat)}</dd>
                      </div>
                    </dl>
                    {chProp?.note ? (
                      <p className="muted vat-sources-drive-draft-note">
                        {chProp.note}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn vat-mini-btn"
                      disabled={Boolean(busy) || !canConfirm}
                      onClick={() => void onConfirmF5([ch])}
                    >
                      ซุ่มตรวจแล้ว · ยืนยันรางนี้
                    </button>
                  </div>
                </section>
              </div>
            </article>
          );
        })}
      </div>

      <pre
        id="vat-sources-drive-handoff"
        className="vat-sources-drive-handoff"
        data-ai-notes="1"
      >{`# vat-sources-drive-slot · handoff
month=${monthKey}
driveReady=${readyCount}/6
files=${fileTotal}
hasDriveScope=${hasDriveScope ? 1 : 0}
rootFolderId=${rootFolderId || "-"}
proposal=${proposal ? `${proposal.phase}/${proposal.status}` : "none"}
confirmable=${confirmableChannels.join(",") || "-"}
checks=F0=${f0Ready ? 1 : 0} F1=${f1Ready ? 1 : 0} F2=1 F3=1 F4=${f4Ready ? 1 : 0} F5=${f5Ready ? 1 : 0}
verify=${MONTH_CHANNELS.map((ch) => {
  const s = summarizeChannelChecks(channelCheckMap[ch] || []);
  return `${ch}:${s.ready}/${s.applicable}`;
}).join(" ")}
cols=ยอดขายแอพ|ยอดโอน|คชจ.GP|VAT-ซื้อ
layout=horizontal-tracks
owner=ซุ่มตรวจเท่านั้น · ไม่กรอกเอง
next=${!hasDriveScope ? "reconnect OAuth drive.file" : !fileTotal ? "sync mail + vatMailDriveSync" : !f4Ready ? "ระบบเติม F4 / AI days[] adapter" : !f5Ready ? "owner ซุ่มตรวจ + F5" : "done"}
doc=docs/vat-delivery-drive-spine.md
ui=#vat-sources-drive-slot
`}</pre>
    </section>
  );
}
