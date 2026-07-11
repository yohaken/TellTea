"use client";

import { useEffect } from "react";
import { subscribeAlertSettings, DEFAULT_ALERT_SETTINGS } from "@/lib/settings";

const STYLE_ID = "telltea-ui-settings";

function makeCss(settings: { balanceFontSize: number; actionBtnScale: number }) {
  return [
    `.balance-bar strong { font-size: ${settings.balanceFontSize}rem; }`,
    `.quick-actions .primary-btn { transform: scale(${settings.actionBtnScale}); transform-origin: center left; }`,
  ].join("\n");
}

export function UiSettingsProvider() {
  useEffect(() => {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
    el.innerHTML = makeCss(DEFAULT_ALERT_SETTINGS);

    const unsub = subscribeAlertSettings(
      (s) => {
        el.innerHTML = makeCss(s);
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
