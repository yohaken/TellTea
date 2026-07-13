"use client";

import { useEffect, useState } from "react";

/**
 * แสดง placeholder หนึ่งจังหวะก่อน decode รูป — ไม่บล็อกแตะเมนู
 * รูปควรโผล่เกือบทันทีหลังมี url (data URL / เครือข่าย)
 */
export function PosLazyMenuImage({
  url,
  className,
  placeholder = "☕",
  placeholderClassName = "pos-sell-item-placeholder",
}: {
  url?: string | null;
  className?: string;
  placeholder?: string;
  placeholderClassName?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [url]);

  if (!url) {
    if (!placeholder) return null;
    return (
      <span className={placeholderClassName} aria-hidden>
        {placeholder}
      </span>
    );
  }

  return (
    <div className="pos-lazy-menu-image">
      {!loaded ? (
        <span className={placeholderClassName} aria-hidden>
          {placeholder}
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className={`${className || ""} ${loaded ? "is-loaded" : "is-loading"}`}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </div>
  );
}
