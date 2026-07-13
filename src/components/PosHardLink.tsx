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
  onClick,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
  onClick?: () => void;
} & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label">) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        e.preventDefault();
        onClick?.();
        window.location.assign(href);
      }}
    >
      {children}
    </a>
  );
}
