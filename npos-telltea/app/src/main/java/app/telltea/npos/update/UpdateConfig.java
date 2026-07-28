package app.telltea.npos.update;

/**
 * Fixed hosting endpoints for the update channel.
 * Apps always poll the manifest; APK URL inside the JSON can move later.
 */
public final class UpdateConfig {
    private UpdateConfig() {}

    public static final String MANIFEST_URL =
            "https://telltea-pos.web.app/downloads/latest.json";

    public static final String FALLBACK_APK_URL =
            "https://telltea-pos.web.app/downloads/nPos-telltea.apk";

    /**
     * Shared throttle for resume + server-sync-pulse APK checks.
     * Heartbeat ticks every ~5s; this keeps latest.json traffic modest while
     * still surfacing updates within one short window on the sell screen.
     */
    public static final long AUTO_CHECK_MIN_INTERVAL_MS = 20_000L;

    /**
     * "Later" only buys a short quiet window — next sync pulses re-show the
     * mandatory update popup (staff cannot snooze for half an hour).
     */
    public static final long POPUP_SNOOZE_MS = 45_000L;
}
