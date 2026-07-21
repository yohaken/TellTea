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
};

const INITIAL: LedgerAiClassifyState = {
  type: "cogs",
  reason: "",
  source: "heuristic",
  status: "idle",
  error: null,
};

type Options = {
  description: string;
  /** เมื่อ true จะไม่เรียก AI (เช่น เจ้าของล็อกประเภทเอง) */
  locked: boolean;
  /** ค่าเริ่มจากรายการเดิม */
  initial?: { type?: string; reason?: string; source?: LedgerTypeSource };
  debounceMs?: number;
  enabled?: boolean;
};

/**
 * Debounced AI classify จากชื่อรายการปัจจุบัน
 * — ถ้า locked จะไม่รีรัน AI (คงค่าที่เจ้าของเลือก)
 */
export function useLedgerAiClassify({
  description,
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
      };
    }
    return { ...INITIAL };
  });
  const reqId = useRef(0);
  const [tick, setTick] = useState(0);

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
          const result = await classifyLedgerTypeWithAi(text);
          if (reqId.current !== id) return;
          setState({
            type: result.type,
            reason: result.reason,
            source: "ai",
            status: "ready",
            error: null,
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
          });
        }
      })();
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [description, locked, enabled, debounceMs, tick]);

  return {
    ...state,
    refresh: () => setTick((n) => n + 1),
  };
}
