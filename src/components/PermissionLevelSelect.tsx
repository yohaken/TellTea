"use client";

import {
  assignableLevels,
  levelHasElevated,
  summarizeLevelPermissions,
} from "@/lib/permission-levels";
import type { PermissionLevel } from "@/lib/types";

export function PermissionLevelSelect({
  levels,
  value,
  onChange,
  disabled,
  hideElevated = false,
  id = "permission-level",
  allowEmpty = false,
  emptyLabel = "— กำหนดเอง —",
}: {
  levels: PermissionLevel[];
  value: string;
  onChange: (levelId: string) => void;
  disabled?: boolean;
  hideElevated?: boolean;
  id?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const assignable = assignableLevels(levels);
  const options = assignable.filter(
    (l) => !hideElevated || !levelHasElevated(l.permissions) || l.id === value,
  );

  return (
    <select
      id={id}
      className="staff-compact-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {options.map((level) => (
        <option key={level.id} value={level.id}>
          {level.name} — {summarizeLevelPermissions(level.permissions, hideElevated)}
        </option>
      ))}
    </select>
  );
}
