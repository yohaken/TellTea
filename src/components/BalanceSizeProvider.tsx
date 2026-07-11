"use client";

import { useEffect } from "react";
import { subscribeAlertSettings, DEFAULT_ALERT_SETTINGS } from "@/lib/settings";

const STYLE_ID = "telltea-balance-size";

/** Listens to owner's balanceFontSize in meta/settings and applies it as a CSS variable on the root. */
export function BalanceSizeProvider() {
  useEffect(() => {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
    el.innerHTML = `.balance-bar strong { font-size: ${DEFAULT_ALERT_SETTINGS.balanceFontSize}rem; }`;

    const unsub = subscribeAlertSettings(
      (s) => {
        el.innerHTML = `.balance-bar strong { font-size: ${s.balanceFontSize}rem; }`;
      },
      () => {
        /* keep default */
      },
    );

    return () => {
      unsub();
      el.remove();
    };
  }, []);

  return null;
}
