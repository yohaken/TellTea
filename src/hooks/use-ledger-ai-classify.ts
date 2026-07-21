"use client";

import { useEffect, useRef, useState } from "react";
import {
  classifyLedgerTypeHeuristic,
  classifyLedgerTypeWithAi,
  type LedgerTypeSource,
} from "@/lib/ledger-ai";

export type LedgerAiClassifyState = {
  type: string;
  reason: string;
  source: LedgerTypeSource;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  usedImages: number;
};

const INITIAL: LedgerAiClassifyState = {
  type: "cogs",
  reason: "",
  source: "heuristic",
  status: "idle",
  error: null,
  usedImages: 0,
};

type Options = {
  description: string;
  /** URL รูปหลักฐาน — ส่งให้ AI เมื่อชื่อกำกวม */
  imageUrls?: string[];
  /** เมื่อ true จะไม่เรียก AI (เช่น เจ้าของล็อกประเภทเอง) */
  locked: boolean;
  /** ค่าเริ่มจากรายการเดิม */
  initial?: { type?: string; reason?: string; source?: LedgerTypeSource };
  debounceMs?: number;
  enabled?: boolean;
};

function imageKey(urls: string[] | undefined) {
  return (urls || []).map((u) => u.trim()).filter(Boolean).slice(0, 2).join("|");
}

/**
 * Debounced AI classify จากชื่อรายการ (+ รูปถ้ามี)
 * — ถ้า locked จะไม่รีรัน AI (คงค่าที่เจ้าของเลือก)
 */
export function useLedgerAiClassify({
  description,
  imageUrls,
  locked,
  initial,
  debounceMs = 650,
  enabled = true,
}: Options): LedgerAiClassifyState & { refresh: () => void } {
  const [state, setState] = useState<LedgerAiClassifyState>(() => {
    if (initial?.type) {
      return {
        type: initial.type,
        reason: initial.reason || "",
        source: initial.source || "owner",
        status: "ready",
        error: null,
        usedImages: 0,
      };
    }
    return { ...INITIAL };
  });
  const reqId = useRef(0);
  const [tick, setTick] = useState(0);
  const imagesFingerprint = imageKey(imageUrls);

  useEffect(() => {
    if (locked || !enabled) return;
    const text = description.trim();
    if (!text) {
      setState({ ...INITIAL, status: "idle" });
      return;
    }

    const id = ++reqId.current;
    setState((prev) => ({ ...prev, status: "loading", error: null }));

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const urls = imagesFingerprint
            ? imagesFingerprint.split("|").filter(Boolean)
            : [];
          const result = await classifyLedgerTypeWithAi(text, { imageUrls: urls });
          if (reqId.current !== id) return;
          setState({
            type: result.type,
            reason: result.reason,
            source: "ai",
            status: "ready",
            error: null,
            usedImages: result.usedImages,
          });
        } catch (err) {
          if (reqId.current !== id) return;
          const fallback = classifyLedgerTypeHeuristic(text);
          setState({
            type: fallback.type,
            reason: fallback.reason,
            source: "heuristic",
            status: "error",
            error: (err as Error).message || "AI ไม่พร้อม",
            usedImages: 0,
          });
        }
      })();
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [description, imagesFingerprint, locked, enabled, debounceMs, tick]);

  return {
    ...state,
    refresh: () => setTick((n) => n + 1),
  };
}
