import { appVersionLabel } from "@/lib/version";
import { cn } from "@/lib/utils";

export function AppBrand({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <p className={cn("brand", compact && "brand-compact", className)}>
      <span className="brand-name">TellTea</span>{" "}
      <span className="brand-version" title={`build ${appVersionLabel()}`}>
        {appVersionLabel()}
      </span>
    </p>
  );
}
