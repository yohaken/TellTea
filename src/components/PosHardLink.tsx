import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * Full-page navigation for POS static export.
 * Next.js <Link> client routing can fail to change routes on telltea-pos hosting.
 */
export function PosHardLink({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
} & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label">) {
  return (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  );
}
