"use client";

import { useEffect, useRef, useState } from "react";

/**
 * แสดง placeholder ก่อน — รูปของหนักโหลดเมื่อใกล้เข้าจอ / ตอนเครื่องว่าง
 * ไม่บล็อกการแตะเมนูขาย
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
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (!url) {
      setActive(false);
      return;
    }

    const node = boxRef.current;
    if (!node) return;

    let cancelled = false;
    let idleId = 0;
    let timerId = 0;

    const arm = () => {
      if (!cancelled) setActive(true);
    };

    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            arm();
            io.disconnect();
          }
        },
        { rootMargin: "160px" },
      );
      io.observe(node);

      if (typeof requestIdleCallback === "function") {
        idleId = requestIdleCallback(() => arm(), { timeout: 1500 });
      } else {
        timerId = window.setTimeout(arm, 500);
      }

      return () => {
        cancelled = true;
        io.disconnect();
        if (idleId && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
        if (timerId) window.clearTimeout(timerId);
      };
    }

    timerId = window.setTimeout(arm, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
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
    <div ref={boxRef} className="pos-lazy-menu-image">
      {!loaded ? (
        <span className={placeholderClassName} aria-hidden>
          {placeholder}
        </span>
      ) : null}
      {active ? (
        // eslint-disable-next-line @next/next/no-img-element
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
      ) : null}
    </div>
  );
}
