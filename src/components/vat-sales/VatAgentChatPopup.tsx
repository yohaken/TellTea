"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TUNE_DESK_DEFAULT_WAIT_SEC,
  TUNE_DESK_NAME,
  TUNE_DESK_PROTOCOL,
  askStillWaiting,
  clearTuneDeskMentorPresence,
  heartbeatTuneDeskMentor,
  isAskTimedOut,
  loadStoredAgentName,
  loadStoredUiRole,
  postTuneDeskMessage,
  saveStoredAgentName,
  saveStoredUiRole,
  subscribeTuneDeskMessages,
  subscribeTuneDeskPresence,
  type TuneDeskMessage,
  type TuneDeskPresence,
} from "@/lib/vat-agent-chat";

type Props = {
  actor: string;
  monthKey?: string;
};

export function VatAgentChatPopup({ actor, monthKey }: Props) {
  const threadId = "vat-import";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<TuneDeskMessage[]>([]);
  const [presence, setPresence] = useState<TuneDeskPresence>({
    mentorOnline: false,
    mentorName: "Mentor",
    lastSeenAt: 0,
  });
  const [uiRole, setUiRole] = useState<"local" | "mentor">("local");
  const [agentName, setAgentName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [text, setText] = useState("");
  const [asAsk, setAsAsk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAgentName(loadStoredAgentName());
    setNameDraft(loadStoredAgentName());
    setUiRole(loadStoredUiRole());
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = subscribeTuneDeskMessages(
      threadId,
      setMsgs,
      (e) => setErr(e.message),
    );
    return () => unsub();
  }, [threadId]);

  useEffect(() => {
    const unsub = subscribeTuneDeskPresence(setPresence, (e) => setErr(e.message));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (uiRole !== "mentor" || !open) return;
    const name = agentName || "Mentor";
    void heartbeatTuneDeskMentor(name);
    const t = window.setInterval(() => {
      void heartbeatTuneDeskMentor(name);
    }, 20_000);
    return () => {
      window.clearInterval(t);
      void clearTuneDeskMentorPresence();
    };
  }, [uiRole, open, agentName]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  const waitingAsks = useMemo(
    () => msgs.filter((m) => askStillWaiting(m, msgs, now)),
    [msgs, now],
  );

  const unreadHint = waitingAsks.length;

  async function send() {
    const body = text.trim();
    if (!body) return;
    const name = (agentName || nameDraft || "").trim();
    if (!name) {
      setErr("ตั้งชื่อตัวเองก่อน (ใช้ชื่อเดิมทุกครั้ง)");
      return;
    }
    if (name !== agentName) {
      saveStoredAgentName(name);
      setAgentName(name);
    }
    setBusy(true);
    setErr("");
    try {
      const lastAsk = [...msgs].reverse().find((m) => m.isAsk);
      await postTuneDeskMessage({
        threadId,
        role: uiRole === "mentor" ? "mentor" : "local",
        name,
        body: monthKey && uiRole === "local" ? `[${monthKey}] ${body}` : body,
        isAsk: uiRole === "local" && asAsk,
        waitSec: TUNE_DESK_DEFAULT_WAIT_SEC,
        replyToId:
          uiRole === "mentor" && lastAsk && askStillWaiting(lastAsk, msgs, now)
            ? lastAsk.id
            : null,
      });
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmName() {
    const n = nameDraft.trim().slice(0, 40);
    if (!n) {
      setErr("ใส่ชื่อก่อน");
      return;
    }
    saveStoredAgentName(n);
    setAgentName(n);
    setErr("");
  }

  return (
    <>
      <button
        type="button"
        className={
          "vat-tune-desk-fab" + (unreadHint ? " vat-tune-desk-fab--pulse" : "")
        }
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vat-tune-desk-panel"
        title={`${TUNE_DESK_NAME} — แชท AI`}
      >
        {TUNE_DESK_NAME}
        {unreadHint ? <span className="vat-tune-desk-badge">{unreadHint}</span> : null}
      </button>

      {open ? (
        <section
          id="vat-tune-desk-panel"
          className="vat-tune-desk-panel"
          data-ai-context="tune-desk"
          aria-label={TUNE_DESK_NAME}
        >
          <header className="vat-tune-desk-head">
            <div>
              <strong>{TUNE_DESK_NAME}</strong>
              <span className="muted"> · Tune Desk</span>
            </div>
            <button
              type="button"
              className="vat-mini-btn"
              onClick={() => setOpen(false)}
              aria-label="ปิด"
            >
              ×
            </button>
          </header>

          <p
            className={
              "vat-tune-desk-presence" +
              (presence.mentorOnline ? " is-online" : " is-offline")
            }
            data-mentor-online={presence.mentorOnline ? "1" : "0"}
          >
            {presence.mentorOnline
              ? `mentor ออนไลน์ (${presence.mentorName}) — ถามได้ รอได้ ≤${TUNE_DESK_DEFAULT_WAIT_SEC}s`
              : `mentor ออฟไลน์ — อย่ารอคำตอบ · ไปต่อเอง / ช่องไม่ชัวร์ปล่อยว่าง`}
          </p>

          <details className="vat-tune-desk-protocol">
            <summary>โปรโตคอลสั้น (local AI อ่าน)</summary>
            <ol>
              {TUNE_DESK_PROTOCOL.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </details>

          {!agentName ? (
            <div className="vat-tune-desk-namegate">
              <label>
                ตั้งชื่อตัวเอง (ใช้ซ้ำทุกครั้ง)
                <input
                  className="vat-sales-input"
                  value={nameDraft}
                  placeholder="เช่น CursorLocal"
                  maxLength={40}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="vat-mini-btn vat-mini-btn--primary"
                onClick={confirmName}
              >
                ใช้ชื่อนี้
              </button>
            </div>
          ) : (
            <div className="vat-tune-desk-identity">
              <span>
                คุณคือ <strong>{agentName}</strong>
              </span>
              <label className="vat-tune-desk-role">
                โหมด
                <select
                  className="vat-inline-select"
                  value={uiRole}
                  onChange={(e) => {
                    const r = e.target.value === "mentor" ? "mentor" : "local";
                    setUiRole(r);
                    saveStoredUiRole(r);
                  }}
                >
                  <option value="local">local AI</option>
                  <option value="mentor">mentor / cloud</option>
                </select>
              </label>
              <button
                type="button"
                className="vat-mini-btn"
                onClick={() => {
                  setAgentName("");
                  setNameDraft(agentName);
                }}
              >
                เปลี่ยนชื่อ
              </button>
            </div>
          )}

          <div className="vat-tune-desk-log" data-ai-chat-log="1">
            {msgs.length === 0 ? (
              <p className="muted">ยังไม่มีข้อความ — local ถามสั้นๆ ได้เมื่อติด</p>
            ) : (
              msgs.map((m) => {
                const waiting = askStillWaiting(m, msgs, now);
                const timedOut = isAskTimedOut(m, msgs, now);
                const left = m.waitUntil
                  ? Math.max(0, Math.ceil((m.waitUntil - now) / 1000))
                  : 0;
                return (
                  <article
                    key={m.id}
                    className={`vat-tune-desk-msg vat-tune-desk-msg--${m.role}`}
                    data-msg-id={m.id}
                    data-ask-waiting={waiting ? "1" : "0"}
                    data-ask-expired={timedOut ? "1" : "0"}
                  >
                    <header>
                      <strong>{m.name}</strong>
                      <span className="muted"> · {m.role}</span>
                      {m.isAsk ? (
                        <span className="vat-tune-desk-ask-tag">ask</span>
                      ) : null}
                      {waiting ? (
                        <span className="vat-tune-desk-wait">รอ {left}s</span>
                      ) : null}
                      {timedOut ? (
                        <span className="vat-tune-desk-timeout">หมดเวลา·ไปต่อเอง</span>
                      ) : null}
                    </header>
                    <p>{m.body}</p>
                  </article>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {err ? <p className="error-text">{err}</p> : null}

          <footer className="vat-tune-desk-compose">
            {uiRole === "local" ? (
              <label className="vat-tune-desk-askopt">
                <input
                  type="checkbox"
                  checked={asAsk}
                  onChange={(e) => setAsAsk(e.target.checked)}
                />
                Ask (รอตอบ ≤{TUNE_DESK_DEFAULT_WAIT_SEC}s แล้วไปต่อถ้าเงียบ)
              </label>
            ) : (
              <p className="muted vat-tune-desk-askopt">
                โหมด mentor · ตอบสั้น · ติ๊กออนไลน์อัตโนมัติตอนเปิดแผง
              </p>
            )}
            <textarea
              className="vat-tune-desk-input"
              rows={2}
              value={text}
              disabled={!agentName || busy}
              placeholder={
                uiRole === "mentor"
                  ? "ตอบสั้นๆ…"
                  : "ถามสั้นๆ ถ้าติด… (หรือปิด Ask ถ้าแค่แจ้งสถานะ)"
              }
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="vat-mini-btn vat-mini-btn--primary"
              disabled={!agentName || busy || !text.trim()}
              onClick={() => void send()}
            >
              {busy ? "…" : "ส่ง"}
            </button>
            <span className="muted vat-tune-desk-actor">uid {actor}</span>
          </footer>
        </section>
      ) : null}
    </>
  );
}
