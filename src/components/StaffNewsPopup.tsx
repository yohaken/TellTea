"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Megaphone, Minimize2 } from "lucide-react";
import {
  announcedStaffNews,
  staffNewsAnnounceFingerprint,
  subscribeStaffNews,
  type StaffNewsNote,
} from "@/lib/staff-news";

const COLLAPSE_KEY = "telltea_staff_news_collapsed_v1";

function readCollapsedFingerprint(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(COLLAPSE_KEY);
}

function writeCollapsedFingerprint(fp: string | null) {
  if (fp == null) {
    window.sessionStorage.removeItem(COLLAPSE_KEY);
    return;
  }
  window.sessionStorage.setItem(COLLAPSE_KEY, fp);
}

/**
 * แจ้งข่าวสาร/โนตพนักงาน — การ์ดมุมขวาบน (ไม่ทับแถบล่าง)
 * หุบได้เป็นไอคอนขวาบน · กดไอคอนเปิดอ่านอีก · โนตใหม่ (fingerprint เปลี่ยน) ขยายใหม่อัตโนมัติ
 */
export function StaffNewsPopup() {
  const [notes, setNotes] = useState<StaffNewsNote[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
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
      setPanelOpen(false);
      setBodyExpanded(false);
      setIndex(0);
      return;
    }
    const collapsed = readCollapsedFingerprint();
    if (collapsed === fingerprint) {
      setPanelOpen(false);
      return;
    }
    writeCollapsedFingerprint(null);
    setPanelOpen(true);
    setIndex(0);
    setBodyExpanded(false);
  }, [announced.length, fingerprint]);

  if (!announced.length) return null;

  const current = announced[Math.min(index, announced.length - 1)];
  if (!current) return null;

  const hasMore = announced.length > 1;
  const bodyPreview =
    current.body.length > 120 && !bodyExpanded
      ? `${current.body.slice(0, 120).trim()}…`
      : current.body;
  const canExpand = current.body.length > 120;

  function collapse() {
    writeCollapsedFingerprint(fingerprint);
    setPanelOpen(false);
    setBodyExpanded(false);
  }

  function expandPanel() {
    writeCollapsedFingerprint(null);
    setPanelOpen(true);
    setBodyExpanded(false);
  }

  function nextNote() {
    setIndex((i) => (i + 1) % announced.length);
    setBodyExpanded(false);
  }

  if (!panelOpen) {
    return (
      <button
        type="button"
        className="staff-news-fab"
        onClick={expandPanel}
        aria-label={`เปิดแจ้งข่าวสาร${announced.length > 1 ? ` ${announced.length} รายการ` : ""}`}
        title="แจ้งข่าวสาร"
      >
        <Megaphone size={16} aria-hidden />
        {announced.length > 1 ? (
          <span className="staff-news-fab-badge">{announced.length}</span>
        ) : null}
      </button>
    );
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
            onClick={collapse}
            aria-label="หุบแจ้งข่าวสาร"
            title="หุบ"
          >
            <Minimize2 size={15} aria-hidden />
          </button>
        </div>

        <h2 className="staff-news-float-title">{current.title}</h2>

        {current.body ? (
          <p className={`staff-news-float-body${bodyExpanded ? " is-expanded" : ""}`}>
            {bodyPreview}
          </p>
        ) : null}

        <div className="staff-news-float-actions">
          {canExpand ? (
            <button
              type="button"
              className="ghost-btn staff-news-float-btn"
              onClick={() => setBodyExpanded((v) => !v)}
            >
              {bodyExpanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
              {bodyExpanded ? "ย่อ" : "ขยายอ่าน"}
            </button>
          ) : null}
          {hasMore ? (
            <button type="button" className="ghost-btn staff-news-float-btn" onClick={nextNote}>
              ถัดไป
            </button>
          ) : null}
          <button type="button" className="primary-btn staff-news-float-btn" onClick={collapse}>
            หุบ
          </button>
        </div>
      </div>
    </div>
  );
}
