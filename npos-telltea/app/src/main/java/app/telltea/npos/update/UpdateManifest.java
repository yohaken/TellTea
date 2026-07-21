package app.telltea.npos.update;

import org.json.JSONObject;

/** Parsed remote release manifest (`/downloads/latest.json`). */
public final class UpdateManifest {
    public final String product;
    public final int versionCode;
    public final String versionName;
    public final String apkUrl;
    public final String notes;
    public final String publishedAt;
    public final long bytes;

    public UpdateManifest(
            String product,
            int versionCode,
            String versionName,
            String apkUrl,
            String notes,
            String publishedAt,
            long bytes) {
        this.product = product;
        this.versionCode = versionCode;
        this.versionName = versionName;
        this.apkUrl = apkUrl;
        this.notes = notes;
        this.publishedAt = publishedAt;
        this.bytes = bytes;
    }

    public static UpdateManifest fromJson(String raw) throws Exception {
        JSONObject o = new JSONObject(raw);
        int versionCode = o.optInt("versionCode", 0);
        String versionName = o.optString("versionName", "");
        String apkUrl = o.optString("apkUrl", "");
        if (apkUrl.isEmpty()) {
            String path = o.optString("downloadPath", "/downloads/nPos-telltea.apk");
            apkUrl = "https://telltea-pos.web.app" + path;
        }
        if (versionCode <= 0 || versionName.isEmpty() || apkUrl.isEmpty()) {
            throw new IllegalStateException("manifest missing versionCode/versionName/apkUrl");
        }
        return new UpdateManifest(
                o.optString("product", "nPos-telltea"),
                versionCode,
                versionName,
                apkUrl,
                o.optString("notes", ""),
                o.optString("publishedAt", ""),
                o.optLong("bytes", 0L));
    }

    public boolean isNewerThan(int localVersionCode) {
        return versionCode > localVersionCode;
    }
}
