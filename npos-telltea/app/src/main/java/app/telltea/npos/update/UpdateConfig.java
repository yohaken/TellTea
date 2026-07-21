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

    /** Ignore resume auto-checks more often than this. */
    public static final long AUTO_CHECK_MIN_INTERVAL_MS = 60_000L;
}
