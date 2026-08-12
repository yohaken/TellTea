import type { MultiplierTier } from "@/lib/points-multiplier-spin";

/** ไอคอนสินค้าน่ารัก — วาด SVG เบาๆ ไม่พึ่งอีโมจิ */
export function SpinPrizeIcon({
  multiplier,
  className = "",
}: {
  multiplier: MultiplierTier;
  className?: string;
}) {
  const common = {
    className: `pts-spin-icon ${className}`.trim(),
    viewBox: "0 0 48 48",
    "aria-hidden": true as const,
  };

  if (multiplier === 1) {
    // ชาไทย — แก้วส้มทอง + น้ำแข็ง
    return (
      <svg {...common}>
        <path
          d="M14 16h16l2 22a6 6 0 0 1-6 6H18a6 6 0 0 1-6-6l2-22Z"
          fill="#E8913A"
        />
        <path d="M14 16h16l.6 6H13.4L14 16Z" fill="#F5C16C" />
        <rect x="16" y="8" width="12" height="8" rx="2" fill="#FFF6E8" />
        <path d="M32 20c5 0 8 3 8 7s-3 7-8 7" stroke="#003B5C" strokeWidth="2.2" fill="none" />
        <circle cx="20" cy="28" r="2.2" fill="#FFF6E8" opacity="0.85" />
        <circle cx="26" cy="32" r="2" fill="#FFF6E8" opacity="0.7" />
      </svg>
    );
  }

  if (multiplier === 2) {
    // ชานมไข่มุก — แก้ว + ไข่มุก + หลอด
    return (
      <svg {...common}>
        <path
          d="M15 14h14l2.5 24a5.5 5.5 0 0 1-5.5 5.5h-8A5.5 5.5 0 0 1 12.5 38L15 14Z"
          fill="#D4B896"
        />
        <path d="M15 14h14l.8 7H14.2L15 14Z" fill="#FFF6E8" />
        <rect x="21" y="4" width="3.2" height="18" rx="1.5" fill="#0077B6" />
        <circle cx="19" cy="36" r="2.1" fill="#003B5C" />
        <circle cx="25" cy="38" r="2.1" fill="#003B5C" />
        <circle cx="22" cy="33" r="1.8" fill="#003B5C" />
        <circle cx="28" cy="34" r="1.7" fill="#003B5C" />
      </svg>
    );
  }

  if (multiplier === 3) {
    // ซอฟคุกกี้
    return (
      <svg {...common}>
        <ellipse cx="24" cy="26" rx="14" ry="13" fill="#D4A574" />
        <ellipse cx="24" cy="24" rx="12.5" ry="11.5" fill="#E8C49A" />
        <circle cx="18" cy="22" r="2.2" fill="#5C3A2E" />
        <circle cx="27" cy="20" r="1.8" fill="#5C3A2E" />
        <circle cx="23" cy="28" r="2" fill="#5C3A2E" />
        <circle cx="30" cy="27" r="1.6" fill="#5C3A2E" />
        <circle cx="19" cy="30" r="1.4" fill="#5C3A2E" />
      </svg>
    );
  }

  if (multiplier === 4) {
    // บราวนี่
    return (
      <svg {...common}>
        <rect x="10" y="14" width="28" height="22" rx="4" fill="#5C3A2E" />
        <rect x="12" y="16" width="24" height="8" rx="2" fill="#7A4A38" />
        <path
          d="M14 30h20M14 34h12"
          stroke="#3D241C"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.45"
        />
        <circle cx="30" cy="20" r="1.5" fill="#F5C16C" opacity="0.8" />
        <circle cx="18" cy="22" r="1.2" fill="#F5C16C" opacity="0.55" />
      </svg>
    );
  }

  // ×5 ชิโอปัง
  return (
    <svg {...common}>
      <ellipse cx="24" cy="30" rx="15" ry="10" fill="#E8C49A" />
      <path
        d="M10 28c2-10 8-16 14-16s12 6 14 16"
        fill="#F0D48A"
        stroke="#C9852D"
        strokeWidth="1.2"
      />
      <ellipse cx="24" cy="18" rx="7" ry="5" fill="#FFF6E8" />
      <path
        d="M18 18c2 2 4 3 6 3s4-1 6-3"
        stroke="#E8913A"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="20" cy="26" r="1.3" fill="#C9852D" opacity="0.5" />
      <circle cx="28" cy="28" r="1.1" fill="#C9852D" opacity="0.4" />
    </svg>
  );
}

export function SpinBobaPointer({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`pts-spin-boba-pointer ${className}`.trim()}
      viewBox="0 0 24 28"
      aria-hidden
    >
      <circle cx="12" cy="10" r="7" fill="#003B5C" />
      <circle cx="10" cy="8" r="2" fill="#0077B6" opacity="0.55" />
      <path d="M12 17v9" stroke="#0077B6" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 26h8" stroke="#0077B6" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
