"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { SettingsFold } from "@/components/SettingsFold";
import {
  fetchFoodstoryMenuSyncStatus,
  formatSyncWhen,
  runFoodstoryMenuSync,
  saveFoodstoryAuth,
  subscribeFoodstoryMenuSyncMeta,
  type FoodstoryMenuSyncStatus,
  type FoodstorySyncResult,
} from "@/lib/foodstory-menu-sync";

function summaryLine(res: FoodstorySyncResult | null): string {
  if (!res?.summary) return "";
  const s = res.summary;
  return `หมวด +${s.categories.create}/~${s.categories.update}/-${s.categories.delete} · เมนู +${s.items.create}/~${s.items.update}/-${s.items.delete} · กลุ่ม +${s.optionGroups.create}/~${s.optionGroups.update}/-${s.optionGroups.delete}`;
}

export function FoodstoryMenuSyncPanel({ onError }: { onError: (msg: string | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "dry" | "sync" | null>(null);
  const [hasAuth, setHasAuth] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [idKey, setIdKey] = useState("");
  const [lastSync, setLastSync] = useState<FoodstoryMenuSyncStatus["lastSync"]>(null);
  const [authUpdatedAt, setAuthUpdatedAt] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<FoodstorySyncResult | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const st = await fetchFoodstoryMenuSyncStatus();
      setHasAuth(Boolean(st.hasAuth));
      if (st.branchId) setBranchId(String(st.branchId));
      setAuthUpdatedAt(st.authUpdatedAt ?? null);
      if (st.lastSync) setLastSync(st.lastSync);
      onError(null);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    return subscribeFoodstoryMenuSyncMeta(
      (data) => setLastSync(data),
      (err) => onError(err.message),
    );
  }, [onError]);

  async function onSaveAuth() {
    setBusy("save");
    onError(null);
    try {
      const res = await saveFoodstoryAuth({ idKey: idKey.trim(), branchId: branchId.trim() });
      setHasAuth(true);
      setAuthUpdatedAt(res.updatedAt ?? Date.now());
      setIdKey("");
      setLastResult(res);
      await refreshStatus();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onSync(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "sync");
    onError(null);
    try {
      const res = await runFoodstoryMenuSync({
        dryRun,
        ...(idKey.trim() ? { idKey: idKey.trim() } : {}),
        ...(branchId.trim() ? { branchId: branchId.trim() } : {}),
      });
      setLastResult(res);
      if (!dryRun) {
        setIdKey("");
        await refreshStatus();
      }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const counts = lastSync?.counts;

  return (
    <SettingsFold
      title="ระบบซิงก์เมนู (FoodStory)"
      hint="กดซิงก์เพื่อดึงเมนูจาก FoodStory เข้า POS Web · Native รับต่ออัตโนมัติ"
      defaultOpen
      className="foodstory-sync-fold"
    >
      {loading ? (
        <p className="muted">กำลังโหลดสถานะ…</p>
      ) : (
        <div className="foodstory-sync-body">
          <div className="foodstory-sync-status">
            <p>
              เซสชัน FoodStory:{" "}
              <strong>{hasAuth ? "พร้อม" : "ยังไม่มี"}</strong>
              {hasAuth && branchId ? ` · สาขา ${branchId}` : ""}
            </p>
            <p className="muted">
              บันทึกเซสชันล่าสุด: {formatSyncWhen(authUpdatedAt)} · ซิงก์ล่าสุด:{" "}
              {formatSyncWhen(lastSync?.lastAppliedAt)}
            </p>
            {counts ? (
              <p>
                เมนูในรอบล่าสุด: หมวด {counts.categories ?? "—"} · รายการ {counts.items ?? "—"} ·
                กลุ่มตัวเลือก {counts.optionGroups ?? "—"}
              </p>
            ) : null}
          </div>

          <div className="foodstory-sync-fields">
            <label className="foodstory-sync-field">
              <span>branchId</span>
              <input
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                placeholder="จาก localStorage.branch_id"
                autoComplete="off"
              />
            </label>
            <label className="foodstory-sync-field">
              <span>idKey (access-token)</span>
              <input
                type="password"
                value={idKey}
                onChange={(e) => setIdKey(e.target.value)}
                placeholder={hasAuth ? "เว้นว่างถ้าใช้ค่าที่บันทึกไว้ · วางใหม่เพื่ออัปเดต" : "จาก localStorage.idKey"}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="foodstory-sync-actions">
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !branchId.trim() || !idKey.trim()}
              onClick={() => void onSaveAuth()}
            >
              <Save size={16} aria-hidden />
              {busy === "save" ? "กำลังบันทึก…" : "บันทึกเซสชัน"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null || (!hasAuth && (!idKey.trim() || !branchId.trim()))}
              onClick={() => void onSync(true)}
            >
              {busy === "dry" ? "กำลังดูแผน…" : "ดูแผน (dry-run)"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null || (!hasAuth && (!idKey.trim() || !branchId.trim()))}
              onClick={() => void onSync(false)}
            >
              <RefreshCw size={16} aria-hidden />
              {busy === "sync" ? "กำลังซิงก์…" : "ซิงก์เมนูตอนนี้"}
            </button>
          </div>

          {lastResult?.summary ? (
            <p className="muted foodstory-sync-result">
              {lastResult.dryRun ? "แผน: " : "ผลซิงก์: "}
              {summaryLine(lastResult)}
              {lastResult.counts
                ? ` · รวม ${lastResult.counts.items} เมนู / ${lastResult.counts.categories} หมวด`
                : ""}
            </p>
          ) : null}

          <p className="muted foodstory-sync-hint">
            idKey มาจาก Chrome ที่ล็อกอิน FoodStory (localStorage) · บันทึกครั้งแรกครั้งเดียว
            แล้วกดซิงก์ซ้ำได้จนกว่า token จะหมดอายุ
          </p>
        </div>
      )}
    </SettingsFold>
  );
}
