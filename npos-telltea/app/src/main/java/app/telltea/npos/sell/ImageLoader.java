package app.telltea.npos.sell;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Collection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Menu images: memory LRU + durable disk cache under cacheDir/menu_img.
 * HTTP / data: URLs; background prefetch after menu hydrate.
 */
public final class ImageLoader {
    private static final ExecutorService EXEC = Executors.newFixedThreadPool(3);
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
        final String key = cacheKey(url);
        Bitmap cached = CACHE.get(key);
        if (cached != null && !cached.isRecycled()) {
            view.setBackgroundColor(0x00000000);
            view.setImageBitmap(cached);
            return;
        }
        view.setTag(key);
        final Context app = view.getContext().getApplicationContext();
        EXEC.execute(
                () -> {
                    Bitmap bm = load(app, url, key);
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

    /** Warm disk+memory cache for visible menu URLs (non-blocking). */
    public static void prefetch(Context context, Collection<String> urls) {
        if (context == null || urls == null || urls.isEmpty()) return;
        Context app = context.getApplicationContext();
        for (String url : urls) {
            if (url == null || url.trim().isEmpty()) continue;
            final String u = url;
            final String key = cacheKey(u);
            if (CACHE.get(key) != null) continue;
            EXEC.execute(() -> {
                Bitmap bm = load(app, u, key);
                if (bm != null) CACHE.put(key, bm);
            });
        }
    }

    private static Bitmap load(Context app, String url, String key) {
        Bitmap fromDisk = readDisk(app, key);
        if (fromDisk != null) return fromDisk;
        Bitmap decoded = decode(url);
        if (decoded != null) writeDisk(app, key, decoded);
        return decoded;
    }

    static Bitmap decode(String url) {
        try {
            if (url.startsWith("data:image")) {
                int comma = url.indexOf(',');
                if (comma < 0) return null;
                byte[] raw = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
                // Skip huge data-URLs for disk friendliness — still decode for RAM.
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
                opts.inSampleSize = sampleSize(opts.outWidth, opts.outHeight, 320);
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

    private static File diskDir(Context app) {
        File dir = new File(app.getCacheDir(), "menu_img");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static File diskFile(Context app, String key) {
        return new File(diskDir(app), key + ".jpg");
    }

    private static Bitmap readDisk(Context app, String key) {
        try {
            File f = diskFile(app, key);
            if (!f.isFile() || f.length() < 32) return null;
            return BitmapFactory.decodeFile(f.getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeDisk(Context app, String key, Bitmap bm) {
        if (bm == null) return;
        // Skip writing enormous bitmaps from data-URLs if still huge after sample.
        if (bm.getByteCount() > 900_000) return;
        try {
            File f = diskFile(app, key);
            try (FileOutputStream out = new FileOutputStream(f)) {
                bm.compress(Bitmap.CompressFormat.JPEG, 72, out);
            }
        } catch (Exception ignored) {
            /* best-effort */
        }
    }

    private static String cacheKey(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] dig = md.digest(url.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(40);
            for (byte b : dig) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(url.hashCode());
        }
    }

    private static int sampleSize(int w, int h, int maxSide) {
        int sample = 1;
        while (w / sample > maxSide || h / sample > maxSide) sample *= 2;
        return Math.max(1, sample);
    }
}
