"use client";

/**
 * แถบ Gmail ขั้นต่ำบนหน้าที่มา — เชื่อม / ซิงก์เท่านั้น
 * (ไม่มีตารางศึกษา · ไม่มีข้อเสนอ · ไม่มีบันทึก AI)
 */
import { useCallback, useEffect, useState } from "react";
import {
  disconnectVatMail,
  fetchVatMailStatus,
  startVatMailOAuth,
  syncVatMail,
  type VatMailStatus,
} from "@/lib/vat-sales-mail";

const RETURN_TO =
  "https://telltea-shop.web.app/vat-sales/sources/?mail=connected";

type Props = { actor: string };

export function VatSourcesMailBar({ actor: _actor }: Props) {
  const [status, setStatus] = useState<VatMailStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | "">("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await fetchVatMailStatus();
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("mail") === "connected") {
      setMsg("เชื่อม Gmail แล้ว");
      window.history.replaceState({}, "", "/vat-sales/sources/");
      void refresh();
    }
  }, [refresh]);

  const connected = Boolean(status?.connected);

  async function connect() {
    setBusy("connect");
    setError("");
    setMsg("");
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/vat-sales/sources/?mail=connected`
          : RETURN_TO;
      const url = await startVatMailOAuth(returnTo);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    try {
      await disconnectVatMail();
      setMsg("ตัดการเชื่อม Gmail แล้ว");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function sync() {
    setBusy("sync");
    setError("");
    setMsg("");
    try {
      const res = await syncVatMail(45);
      setMsg(
        `ซิงก์เมลแล้ว · สแกน ${res.scanned} · เพิ่ม ${res.added} · ข้าม ${res.skipped}`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="vat-table-block vat-sources-mail" aria-label="Gmail">
      <h3 className="vat-table-subtitle">Gmail</h3>
      <p className="muted vat-sales-hint vat-hint-one-line">
        เชื่อมเพื่อดึงเมลแนบ · ยังไม่แกะตัวเลขเข้างบอัตโนมัติ
      </p>
      <div className="vat-mail-study-toolbar">
        <span className="vat-mail-study-status" title={status?.email || ""}>
          {connected
            ? `เชื่อมแล้ว · ${status?.email || "Gmail"}`
            : status?.hasConfig
              ? "ยังไม่เชื่อม"
              : "ยังไม่มี Client ID"}
        </span>
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
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {msg ? <p className="muted vat-sales-msg">{msg}</p> : null}
    </section>
  );
}
