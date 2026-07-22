package app.telltea.npos.sell;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Loads menu images: data:image base64 (web POS) or http(s). */
public final class ImageLoader {
    private static final ExecutorService EXEC = Executors.newFixedThreadPool(2);
    private static final LruCache<String, Bitmap> CACHE =
            new LruCache<String, Bitmap>((int) (Runtime.getRuntime().maxMemory() / 1024 / 12)) {
                @Override
                protected int sizeOf(String key, Bitmap value) {
                    return value.getByteCount() / 1024;
                }
            };

    private ImageLoader() {}

    public static void bind(ImageView view, String url, int placeholderColor) {
        if (view == null) return;
        view.setImageDrawable(null);
        view.setBackgroundColor(placeholderColor);
        if (url == null || url.trim().isEmpty()) return;
        final String key = url.length() > 64 ? url.substring(0, 64) + url.length() : url;
        Bitmap cached = CACHE.get(key);
        if (cached != null && !cached.isRecycled()) {
            view.setBackgroundColor(0x00000000);
            view.setImageBitmap(cached);
            return;
        }
        view.setTag(key);
        EXEC.execute(
                () -> {
                    Bitmap bm = decode(url);
                    if (bm == null) return;
                    CACHE.put(key, bm);
                    view.post(
                            () -> {
                                if (!key.equals(view.getTag())) return;
                                view.setBackgroundColor(0x00000000);
                                view.setImageBitmap(bm);
                            });
                });
    }

    static Bitmap decode(String url) {
        try {
            if (url.startsWith("data:image")) {
                int comma = url.indexOf(',');
                if (comma < 0) return null;
                byte[] raw = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
                opts.inSampleSize = sampleSize(opts.outWidth, opts.outHeight, 160);
                opts.inJustDecodeBounds = false;
                return BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
            }
            if (url.startsWith("http://") || url.startsWith("https://")) {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8_000);
                c.setReadTimeout(8_000);
                c.setDoInput(true);
                c.connect();
                try (InputStream in = c.getInputStream()) {
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inSampleSize = 2;
                    return BitmapFactory.decodeStream(in, null, opts);
                } finally {
                    c.disconnect();
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private static int sampleSize(int w, int h, int maxSide) {
        int sample = 1;
        while (w / sample > maxSide || h / sample > maxSide) sample *= 2;
        return Math.max(1, sample);
    }
}
