"use client";

import {
  ELEVATED_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type PermissionKey,
  type StaffPermissions,
} from "@/lib/permissions";

export function PermissionPicker({
  value,
  onChange,
  disabled,
  /** ซ่อนสิทธิ์ระดับเจ้าของ — ใช้ตอนคนที่ไม่ใช่เจ้าของจัดการพนักงาน */
  hideElevated = false,
  /** แถวแน่นขึ้น สำหรับหลังร้าน */
  compact = false,
}: {
  value: StaffPermissions;
  onChange: (next: StaffPermissions) => void;
  disabled?: boolean;
  hideElevated?: boolean;
  compact?: boolean;
}) {
  function toggle(key: PermissionKey, checked: boolean) {
    onChange({ ...value, [key]: checked });
  }

  function setGroup(keys: PermissionKey[], checked: boolean) {
    const next = { ...value };
    for (const key of keys) next[key] = checked;
    onChange(next);
  }

  const elevated = new Set<PermissionKey>(ELEVATED_PERMISSION_KEYS);

  return (
    <div className={`permission-picker${compact ? " is-compact" : ""}`}>
      {PERMISSION_GROUPS.map((group) => {
        const keys = group.keys.filter((key) => {
          if (key === "assignTasks") return false;
          if (hideElevated && elevated.has(key)) return false;
          return true;
        });
        if (!keys.length) return null;
        const enabled = keys.filter((k) => value[k]).length;
        const allOn = enabled === keys.length;
        return (
          <section key={group.title} className="permission-group">
            <div className="permission-group-head">
              <div>
                <h3 className="permission-group-title">{group.title}</h3>
                {!compact && group.hint ? (
                  <p className="permission-group-hint">{group.hint}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="ghost-btn permission-group-toggle staff-btn-sm"
                disabled={disabled}
                onClick={() => setGroup(keys, !allOn)}
              >
                {allOn ? "ปิดกลุ่ม" : "เปิดกลุ่ม"}
              </button>
            </div>
            <ul className={`permission-list${compact ? " is-compact-grid" : ""}`}>
              {keys.map((key) => (
                <li key={key}>
                  <label className="permission-row">
                    <input
                      type="checkbox"
                      checked={value[key]}
                      disabled={disabled}
                      onChange={(e) => toggle(key, e.target.checked)}
                    />
                    <span className="permission-row-text">
                      <strong>{PERMISSION_LABELS[key]}</strong>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="permission-group-count muted">
              {enabled}/{keys.length}
            </p>
          </section>
        );
      })}
    </div>
  );
}
