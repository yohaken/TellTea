import { appVersionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";

export function AppBrand({
  className,
  compact = false,
  showLogo = true,
}: {
  className?: string;
  compact?: boolean;
  /** แสดงไอคอนโลโก้ข้างชื่อ */
  showLogo?: boolean;
}) {
  return (
    <div className={cn("brand-wrap", compact && "brand-wrap-compact", className)}>
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={compact ? "/logo-mark.svg" : "/logo-telltea.svg"}
          alt=""
          className={cn("brand-logo", compact && "brand-logo-compact")}
          aria-hidden
        />
      ) : null}
      <p className={cn("brand", compact && "brand-compact")}>
        <span className="brand-name">Tell Tea</span>{" "}
        <span className="brand-version" title={`build ${appVersionLabel()}`}>
          {appVersionLabel()}
        </span>
      </p>
    </div>
  );
}
