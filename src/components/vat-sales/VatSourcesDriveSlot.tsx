"use client";

/**
 * ช่องไฟล์ Drive — F0–F5
 * ซิงก์ไฟล์ · ร่างยอด (F4) · ยืนยันลงตาราง (F5)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MONTH_CHANNEL_LABEL, MONTH_CHANNELS } from "@/lib/vat-month-sources";
import { formatThaiMonthKey } from "@/lib/vat-monthly";
import { formatVatMoney } from "@/lib/vat-number-format";
import type { MonthChannel } from "@/lib/vat-month-books";
import {
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
  type VatDeliveryMonthProposal,
} from "@/lib/vat-delivery-month-proposals";

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
          label: "ซิงก์แนบเมล → Drive แยกแอพ/เดือน",
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
      const r = await syncVatMail(45);
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
      const r = await syncVatMailDrive({ monthKey });
      const errHint = r.errors?.length ? ` · เตือน: ${r.errors[0]}` : "";
      setMsg(
        `Drive · อัป ${r.uploaded} ไฟล์ · สแกน ${r.scanned}` +
          (r.rootCreated ? " · สร้าง TellTea-VAT" : "") +
          errHint,
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
      <h3 className="vat-table-subtitle">ไฟล์ Drive — แยกแอพ</h3>
      <p className="muted vat-sales-hint vat-hint-one-line">
        เดือน {formatThaiMonthKey(monthKey)} · TellTea-VAT/แอพ/{monthKey}/ ·
        ซิงก์ไฟล์ → ร่างยอด → ยืนยันลงตาราง
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
          {busy === "drive" ? "ซิงก์ Drive…" : "ซิงก์ไฟล์ → Drive"}
        </button>
        <button
          type="button"
          className="ghost-btn vat-mini-btn"
          disabled={Boolean(busy)}
          onClick={() => void onDraftF4()}
        >
          {busy === "draft" ? "ร่างยอด…" : "ร่างยอด F4"}
        </button>
        <button
          type="button"
          className="primary-btn vat-mini-btn"
          disabled={Boolean(busy) || !confirmableChannels.length}
          onClick={() => void onConfirmF5()}
        >
          {busy === "confirm" ? "กำลังผสาน…" : "ยืนยันลงตาราง F5"}
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
        className="vat-sources-drive-boxes"
        data-drive-files={String(fileTotal)}
        aria-label="กล่องไฟล์แยกแอพ"
      >
        {MONTH_CHANNELS.map((ch) => {
          const folder = `TellTea-VAT/${CHANNEL_FOLDER[ch]}/${monthKey}/`;
          const list = files[ch] || [];
          const chProp = proposal?.channels[ch];
          const canConfirm = channelHasConfirmableAmounts(chProp);
          return (
            <article
              key={ch}
              className="vat-sources-drive-box"
              data-channel={ch}
              data-file-count={String(list.length)}
            >
              <header className="vat-sources-drive-box-head">
                <h4 className="vat-sources-drive-box-title">
                  {MONTH_CHANNEL_LABEL[ch]}
                </h4>
                {list.length ? (
                  <span className="vat-sources-drive-count">
                    {list.length} ไฟล์
                  </span>
                ) : (
                  <span className="vat-sources-drive-empty">ว่าง · 0 ไฟล์</span>
                )}
              </header>
              <p className="muted vat-sources-drive-path">{folder}</p>
              <ul className="vat-sources-drive-file-list">
                {list.length === 0 ? (
                  <li className="muted vat-sources-drive-file-empty">
                    {loading
                      ? "กำลังโหลด…"
                      : "ยังไม่มีไฟล์ — ซิงก์เมล แล้วกดซิงก์ไฟล์ → Drive"}
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
                    </li>
                  ))
                )}
              </ul>

              <div className="vat-sources-drive-draft" data-draft={ch}>
                <p className="vat-sources-drive-draft-title">ร่างยอด F4</p>
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
                  ยืนยันช่องนี้ → ตาราง
                </button>
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
next=${!hasDriveScope ? "reconnect OAuth drive.file" : !fileTotal ? "sync mail + vatMailDriveSync" : !f4Ready ? "draft F4 / agent propose" : !f5Ready ? "owner confirm F5" : "done"}
doc=docs/vat-delivery-drive-spine.md
ui=#vat-sources-drive-slot
`}</pre>
    </section>
  );
}
