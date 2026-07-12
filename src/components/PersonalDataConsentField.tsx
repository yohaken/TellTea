"use client";

import { PERSONAL_DATA_CONSENT_TEXT } from "@/lib/pdpa";

export function PersonalDataConsentField({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="pdpa-consent-field">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{PERSONAL_DATA_CONSENT_TEXT}</span>
    </label>
  );
}
