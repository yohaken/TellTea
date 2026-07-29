"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Megaphone, X } from "lucide-react";
import {
  announcedStaffNews,
  staffNewsAnnounceFingerprint,
  subscribeStaffNews,
  type StaffNewsNote,
} from "@/lib/staff-news";

const DISMISS_KEY = "telltea_staff_news_dismissed_v1";

function readDismissedFingerprint(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(DISMISS_KEY);
}

function writeDismissedFingerprint(fp: string) {
  window.sessionStorage.setItem(DISMISS_KEY, fp);
}

/**
 * Popup ลอยแจ้งข่าวสารพนักงาน — ทุกคนรวมเจ้าของเห็นช่วงพัฒนา
 * ปิดได้ในรอบนี้ แต่เปิดแอปใหม่จะลอยอีก จนกว่าเจ้าของจะเอาโนตออกจากแจ้ง
 */
export function StaffNewsPopup() {
  const [notes, setNotes] = useState<StaffNewsNote[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    return subscribeStaffNews((doc) => {
      setNotes(doc.notes);
    });
  }, []);

  const announced = useMemo(() => announcedStaffNews(notes), [notes]);
  const fingerprint = useMemo(() => staffNewsAnnounceFingerprint(notes), [notes]);

  useEffect(() => {
    if (!announced.length || !fingerprint) {
      setOpen(false);
      setExpanded(false);
      setIndex(0);
      return;
    }
    const dismissed = readDismissedFingerprint();
    if (dismissed === fingerprint) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setIndex(0);
    setExpanded(false);
  }, [announced.length, fingerprint]);

  if (!open || !announced.length) return null;

  const current = announced[Math.min(index, announced.length - 1)];
  if (!current) return null;

  const hasMore = announced.length > 1;
  const bodyPreview =
    current.body.length > 120 && !expanded
      ? `${current.body.slice(0, 120).trim()}…`
      : current.body;
  const canExpand = current.body.length > 120;

  function dismiss() {
    writeDismissedFingerprint(fingerprint);
    setOpen(false);
    setExpanded(false);
  }

  function nextNote() {
    setIndex((i) => (i + 1) % announced.length);
    setExpanded(false);
  }

  return (
    <div className="staff-news-float" role="region" aria-label="แจ้งข่าวสาร">
      <div className="staff-news-float-card">
        <div className="staff-news-float-top">
          <p className="staff-news-float-kicker">
            <Megaphone size={14} aria-hidden />
            แจ้งข่าวสาร
            {hasMore ? (
              <span className="staff-news-float-count">
                {index + 1}/{announced.length}
              </span>
            ) : null}
          </p>
          <button
            type="button"
            className="staff-news-float-close"
            onClick={dismiss}
            aria-label="ปิดแจ้งข่าวสาร"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <h2 className="staff-news-float-title">{current.title}</h2>

        {current.body ? (
          <p className={`staff-news-float-body${expanded ? " is-expanded" : ""}`}>
            {bodyPreview}
          </p>
        ) : null}

        <div className="staff-news-float-actions">
          {canExpand ? (
            <button
              type="button"
              className="ghost-btn staff-news-float-btn"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
              {expanded ? "ย่อ" : "ขยายอ่าน"}
            </button>
          ) : null}
          {hasMore ? (
            <button type="button" className="ghost-btn staff-news-float-btn" onClick={nextNote}>
              ถัดไป
            </button>
          ) : null}
          <button type="button" className="primary-btn staff-news-float-btn" onClick={dismiss}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
