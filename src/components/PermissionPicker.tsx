"use client";

import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type PermissionKey,
  type StaffPermissions,
} from "@/lib/permissions";

export function PermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: StaffPermissions;
  onChange: (next: StaffPermissions) => void;
  disabled?: boolean;
}) {
  function toggle(key: PermissionKey, checked: boolean) {
    onChange({ ...value, [key]: checked });
  }

  function setGroup(keys: PermissionKey[], checked: boolean) {
    const next = { ...value };
    for (const key of keys) next[key] = checked;
    onChange(next);
  }

  return (
    <div className="permission-picker">
      {PERMISSION_GROUPS.map((group) => {
        const enabled = group.keys.filter((k) => value[k]).length;
        const allOn = enabled === group.keys.length;
        return (
          <section key={group.title} className="permission-group">
            <div className="permission-group-head">
              <div>
                <h3 className="permission-group-title">{group.title}</h3>
                {group.hint ? <p className="permission-group-hint">{group.hint}</p> : null}
              </div>
              <button
                type="button"
                className="ghost-btn permission-group-toggle"
                disabled={disabled}
                onClick={() => setGroup(group.keys, !allOn)}
              >
                {allOn ? "ปิดทั้งกลุ่ม" : "เปิดทั้งกลุ่ม"}
              </button>
            </div>
            <ul className="permission-list">
              {group.keys.map((key) => (
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
              เปิด {enabled}/{group.keys.length}
            </p>
          </section>
        );
      })}
    </div>
  );
}
