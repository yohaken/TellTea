"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  StaffBonusBundle,
  StaffProductionBundle,
  StaffWorkBundleError,
  StaffWorkLoadStatus,
  StaffWorkPage,
} from "@/lib/staff-work-bundle";
import {
  loadStaffBonusBundleFromServer,
  loadStaffProductionBundleFromServer,
  subscribeStaffBonusBundleLive,
  subscribeStaffProductionBundleLive,
} from "@/lib/staff-work-load";
import type { StaffMember } from "@/lib/types";
import { parseMonthInput } from "@/lib/bonus";

type UseStaffWorkBundleArgs = {
  page: StaffWorkPage;
  month: string;
  staff: StaffMember | null;
  authReady: boolean;
  enabled: boolean;
};

type UseStaffWorkBundleResult = {
  status: StaffWorkLoadStatus;
  error: StaffWorkBundleError | null;
  bonusBundle: StaffBonusBundle | null;
  productionBundle: StaffProductionBundle | null;
  retry: () => void;
};

export function useStaffWorkBundle({
  page,
  month,
  staff,
  authReady,
  enabled,
}: UseStaffWorkBundleArgs): UseStaffWorkBundleResult {
  const [status, setStatus] = useState<StaffWorkLoadStatus>("loading");
  const [error, setError] = useState<StaffWorkBundleError | null>(null);
  const [bonusBundle, setBonusBundle] = useState<StaffBonusBundle | null>(null);
  const [productionBundle, setProductionBundle] = useState<StaffProductionBundle | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const retry = useCallback(() => setLoadKey((k) => k + 1), []);

  useEffect(() => {
    if (!enabled || !authReady || !staff) {
      setStatus("loading");
      setError(null);
      setBonusBundle(null);
      setProductionBundle(null);
      return;
    }

    const gen = loadKey;
    let cancelled = false;
    let unsubLive: (() => void) | undefined;

    setStatus("loading");
    setError(null);
    setBonusBundle(null);
    setProductionBundle(null);

    const { year, month: monthIdx } = parseMonthInput(month);

    void (async () => {
      if (page === "bonus") {
        const result = await loadStaffBonusBundleFromServer(staff, month, year, monthIdx);
        if (cancelled || gen !== loadKey) return;
        if ("error" in result) {
          setStatus(result.error.status);
          setError(result.error);
          return;
        }
        setBonusBundle(result.bundle);
        setStatus("ready");
        unsubLive = subscribeStaffBonusBundleLive(
          staff,
          month,
          year,
          monthIdx,
          result.bundle.linked,
          (patch) => {
            if (cancelled) return;
            setBonusBundle((prev) => (prev ? { ...prev, ...patch } : prev));
          },
          (liveErr) => {
            if (cancelled) return;
            setStatus(liveErr.status);
            setError(liveErr);
          },
        );
        return;
      }

      if (page === "production") {
        const result = await loadStaffProductionBundleFromServer(staff, year, monthIdx);
        if (cancelled || gen !== loadKey) return;
        if ("error" in result) {
          setStatus(result.error.status);
          setError(result.error);
          return;
        }
        setProductionBundle(result.bundle);
        setStatus("ready");
        unsubLive = subscribeStaffProductionBundleLive(
          staff,
          year,
          monthIdx,
          result.bundle.linked,
          result.bundle.workers,
          (patch) => {
            if (cancelled) return;
            setProductionBundle((prev) => (prev ? { ...prev, ...patch } : prev));
          },
          (liveErr) => {
            if (cancelled) return;
            setStatus(liveErr.status);
            setError(liveErr);
          },
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubLive?.();
    };
  }, [page, month, staff, authReady, enabled, loadKey]);

  return { status, error, bonusBundle, productionBundle, retry };
}
