package app.telltea.npos.update;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Downloads an APK into app cache for PackageInstaller. */
public final class UpdateDownloader {
    public interface Callback {
        void onProgress(int percent);

        void onComplete(File apkFile);

        void onError(Exception error);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    public void download(Context context, String apkUrl, Callback callback) {
        cancelled.set(false);
        executor.execute(() -> {
            HttpURLConnection conn = null;
            File outFile = new File(context.getCacheDir(), "nPos-telltea-update.apk");
            try {
                if (outFile.exists() && !outFile.delete()) {
                    throw new IllegalStateException("cannot clear old apk cache");
                }
                String url = apkUrl + (apkUrl.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis();
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20_000);
                conn.setReadTimeout(60_000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Cache-Control", "no-cache");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("HTTP " + code);
                }
                long total = conn.getContentLengthLong();
                long read = 0L;
                byte[] buf = new byte[64 * 1024];
                try (InputStream in = conn.getInputStream();
                        FileOutputStream out = new FileOutputStream(outFile)) {
                    int n;
                    int lastPct = -1;
                    while ((n = in.read(buf)) >= 0) {
                        if (cancelled.get()) {
                            throw new IllegalStateException("download cancelled");
                        }
                        out.write(buf, 0, n);
                        read += n;
                        if (total > 0) {
                            int pct = (int) Math.min(100, (read * 100L) / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                callback.onProgress(pct);
                            }
                        }
                    }
                    out.flush();
                }
                if (outFile.length() < 10_000) {
                    throw new IllegalStateException("apk too small (" + outFile.length() + " bytes)");
                }
                callback.onComplete(outFile);
            } catch (Exception e) {
                if (outFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
                }
                callback.onError(e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    public void cancel() {
        cancelled.set(true);
    }

    public void shutdown() {
        cancel();
        executor.shutdownNow();
    }
}
