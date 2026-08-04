"use client";

import { useMemo, useState, type FormEvent } from "react";
import { PermissionPicker } from "@/components/PermissionPicker";
import {
  createPermissionLevel,
  deletePermissionLevel,
  isOwnerSystemLevel,
  levelHasElevated,
  summarizeLevelPermissions,
  updatePermissionLevel,
} from "@/lib/permission-levels";
import {
  DEFAULT_STAFF_PERMISSIONS,
  clampPermissionsForNonOwner,
  type StaffPermissions,
} from "@/lib/permissions";
import type { PermissionLevel } from "@/lib/types";
import { mapFirestoreError } from "@/lib/firestore-errors";

type Props = {
  levels: PermissionLevel[];
  isOwner: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onError: (msg: string | null) => void;
  onSuccess: (msg: string | null) => void;
  onReload: () => Promise<void>;
  linkedCountByLevelId: Map<string, number>;
  onPreviewLevel?: (level: PermissionLevel) => void;
  /** เมื่อฝังในส่วนพับของหน้า staff — ไม่ซ้ำหัวข้อนอก */
  embedded?: boolean;
};

export function PermissionLevelsPanel({
  levels,
  isOwner,
  busy,
  setBusy,
  onError,
  onSuccess,
  onReload,
  linkedCountByLevelId,
  onPreviewLevel,
  embedded = false,
}: Props) {
  const sorted = useMemo(
    () => [...levels].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th")),
    [levels],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("40");
  const [perms, setPerms] = useState<StaffPermissions>({ ...DEFAULT_STAFF_PERMISSIONS });
  const [syncLinked, setSyncLinked] = useState(true);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setName("");
    setSortOrder("40");
    setPerms({ ...DEFAULT_STAFF_PERMISSIONS });
    onError(null);
  }

  function startEdit(level: PermissionLevel) {
    if (isOwnerSystemLevel(level)) {
      onError("ลำดับเจ้าของเป็นของระบบ แก้ไม่ได้");
      return;
    }
    if (!isOwner && (level.isSystem || levelHasElevated(level.permissions))) {
      onError("ลำดับนี้แก้ได้เฉพาะเจ้าของ");
      return;
    }
    setCreating(false);
    setEditingId(level.id);
    setName(level.name);
    setSortOrder(String(level.sortOrder));
    setPerms({ ...level.permissions });
    setSyncLinked(true);
    onError(null);
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    onSuccess(null);
    try {
      const orderNum = Number(sortOrder);
      const safePerms = isOwner ? perms : clampPermissionsForNonOwner(perms);
      if (creating) {
        await createPermissionLevel(
          {
            name,
            sortOrder: Number.isFinite(orderNum) ? orderNum : 40,
            permissions: safePerms,
          },
          { asOwner: isOwner },
        );
        onSuccess(`สร้างลำดับ "${name.trim()}" แล้ว`);
      } else if (editingId) {
        await updatePermissionLevel(
          editingId,
          {
            name,
            sortOrder: Number.isFinite(orderNum) ? orderNum : undefined,
            permissions: safePerms,
            syncLinkedStaff: syncLinked,
          },
          { asOwner: isOwner },
        );
        onSuccess(
          syncLinked
            ? `บันทึกลำดับแล้ว · sync คนที่ยังไม่กำหนดเอง`
            : `บันทึกลำดับแล้ว`,
        );
      }
      cancelForm();
      await onReload();
    } catch (err) {
      onError(mapFirestoreError(err, "บันทึกลำดับไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleActive(level: PermissionLevel) {
    if (isOwnerSystemLevel(level)) return;
    setBusy(true);
    onError(null);
    try {
      await updatePermissionLevel(
        level.id,
        { active: !level.active },
        { asOwner: isOwner },
      );
      await onReload();
    } catch (err) {
      onError(mapFirestoreError(err, "อัปเดตไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(level: PermissionLevel) {
    if (!window.confirm(`ลบลำดับ "${level.name}"?`)) return;
    setBusy(true);
    onError(null);
    try {
      await deletePermissionLevel(level.id);
      onSuccess(`ลบ "${level.name}" แล้ว`);
      await onReload();
    } catch (err) {
      onError(mapFirestoreError(err, "ลบไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  const showForm = creating || !!editingId;

  return (
    <section className={embedded ? "staff-levels-embedded" : "staff-hub-panel"}>
      {embedded ? (
        !showForm ? (
          <div className="staff-levels-embedded-actions">
            <button type="button" className="primary-btn staff-btn-sm" disabled={busy} onClick={startCreate}>
              + ลำดับ
            </button>
          </div>
        ) : null
      ) : (
        <div className="staff-hub-panel-head">
          <div>
            <h2 className="staff-hub-panel-title">ลำดับสิทธิ์</h2>
            <p className="staff-hub-panel-hint">แม่แบบสิทธิ์ — ผูกตอนสร้างบัญชี · แก้รายคนได้</p>
          </div>
          {!showForm ? (
            <button type="button" className="primary-btn staff-btn-sm" disabled={busy} onClick={startCreate}>
              + ลำดับ
            </button>
          ) : null}
        </div>
      )}

      {showForm ? (
        <form className="staff-compact-form" onSubmit={(e) => void onSave(e)}>
          <div className="staff-compact-form-grid">
            <label className="field">
              <span>ชื่อลำดับ</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น พนักงานพาร์ทไทม์"
                required
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>ลำดับแสดง</span>
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <PermissionPicker
            value={perms}
            onChange={setPerms}
            disabled={busy}
            hideElevated={!isOwner}
            compact
          />
          {editingId ? (
            <label className="staff-sync-check">
              <input
                type="checkbox"
                checked={syncLinked}
                onChange={(e) => setSyncLinked(e.target.checked)}
                disabled={busy}
              />
              <span>อัปเดตคนที่ผูกลำดับนี้และยังไม่กำหนดเอง</span>
            </label>
          ) : null}
          <div className="staff-compact-actions">
            <button type="submit" className="primary-btn staff-btn-sm" disabled={busy}>
              {busy ? "..." : "บันทึก"}
            </button>
            <button type="button" className="ghost-btn staff-btn-sm" disabled={busy} onClick={cancelForm}>
              ยกเลิก
            </button>
          </div>
        </form>
      ) : null}

      <div className="staff-level-list">
        {sorted.length === 0 ? (
          <p className="muted staff-empty">ยังไม่มีลำดับ — กด + ลำดับ หรือรอ seed</p>
        ) : (
          sorted.map((level) => {
            const linked = linkedCountByLevelId.get(level.id) || 0;
            const locked = isOwnerSystemLevel(level);
            const canEdit =
              !locked && (isOwner || (!level.isSystem && !levelHasElevated(level.permissions)));
            return (
              <div
                key={level.id}
                className={`staff-level-row${!level.active ? " is-inactive" : ""}`}
              >
                <div className="staff-level-main">
                  <div className="staff-level-name-row">
                    <strong>{level.name}</strong>
                    {level.isSystem ? <span className="staff-chip">ระบบ</span> : null}
                    {!level.active ? <span className="staff-chip is-muted">ปิด</span> : null}
                    {linked > 0 ? <span className="staff-chip is-soft">{linked} คน</span> : null}
                  </div>
                  <div className="muted staff-level-meta">
                    #{level.sortOrder} · {summarizeLevelPermissions(level.permissions, !isOwner)}
                  </div>
                </div>
                <div className="staff-level-actions">
                  {isOwner && onPreviewLevel && level.active && !isOwnerSystemLevel(level) ? (
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm"
                      disabled={busy}
                      onClick={() => onPreviewLevel(level)}
                      title="ดูเมนูตามลำดับนี้"
                    >
                      ดูแบบนี้
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm"
                      disabled={busy}
                      onClick={() => startEdit(level)}
                    >
                      แก้
                    </button>
                  ) : null}
                  {!locked ? (
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm"
                      disabled={busy || (!isOwner && levelHasElevated(level.permissions))}
                      onClick={() => void onToggleActive(level)}
                    >
                      {level.active ? "ปิด" : "เปิด"}
                    </button>
                  ) : null}
                  {!level.isSystem ? (
                    <button
                      type="button"
                      className="ghost-btn staff-btn-sm is-danger"
                      disabled={busy || linked > 0}
                      title={linked > 0 ? "ย้ายคนออกก่อน" : "ลบ"}
                      onClick={() => void onDelete(level)}
                    >
                      ลบ
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
