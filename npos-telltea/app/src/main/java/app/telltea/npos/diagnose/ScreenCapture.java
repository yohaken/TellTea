package app.telltea.npos.diagnose;

import android.app.Activity;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.widget.TextView;

import app.telltea.npos.NposApp;
import app.telltea.npos.R;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Capture tablet screen for BO.
 *
 * <ol>
 *   <li>MediaProjection (real screen) when consent is live
 *   <li>PixelCopy / View.draw of our windows as fallback
 *   <li>Never upload synthetic green status frames as successful shots
 * </ol>
 */
public final class ScreenCapture {
    public static final String REPORT_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/reportNposScreenCapture";

    /** Native-ish capture: keep up to 1920 on the long edge (was 720). */
    private static final int MAX_EDGE = 1920;
    private static final int JPEG_QUALITY = 88;
    /** Soft cap so POST stays under CF MAX_B64 (~6MB per role). */
    private static final int MAX_JPEG_BYTES = 3_500_000;
    private static final Object LOCK = new Object();
    private static final ExecutorService EXEC = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static boolean running;

    private ScreenCapture() {}

    public static void requestCapture(Context context, long requestAt, String reason) {
        Context app = context.getApplicationContext();
        final String why = reason == null ? "manual" : reason;

        // Capture consent is separate from BT/notifications — ask only when needed.
        if (CaptureProjectionPrefs.shouldAutoPrompt(app, why)) {
            Activity fg = NposApp.foregroundActivity();
            if (fg != null || "after_update".equals(why) || "manual".equals(why)) {
                OpsLogger.info(app, "display", "แคปจอ · รออนุญาตแชร์หน้าจอ", why);
                CaptureConsentActivity.launchIfNeeded(app, requestAt, why);
                // Do not ack yet — heartbeat will retry after staff accepts.
                return;
            }
            OpsLogger.warn(app, "display", "แคปจอ · ยังไม่มีสิทธิ์และแอปไม่ได้อยู่หน้าจอ", why);
            // Fall through: still try PixelCopy if somehow possible; else report fail.
        }

        synchronized (LOCK) {
            if (running) return;
            running = true;
        }
        EXEC.execute(
                () -> {
                    try {
                        runCapture(app, requestAt, why);
                    } catch (Exception e) {
                        OpsLogger.error(
                                app,
                                "display",
                                "แคปจอไม่สำเร็จ",
                                e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                    } finally {
                        synchronized (LOCK) {
                            running = false;
                        }
                    }
                });
    }

    private static void runCapture(Context app, long requestAt, String reason) throws Exception {
        List<DisplayProbe.DisplayInfo> displays = DisplayProbe.listDisplays(app);
        JSONArray displayJson = new JSONArray();
        for (DisplayProbe.DisplayInfo d : displays) {
            displayJson.put(displayToJson(d));
        }

        CaptureShot primary = capturePrimary(app);
        CaptureShot secondary = captureSecondary(app);

        JSONObject body = new JSONObject();
        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
        body.put("stableKey", DeviceIdentity.stableKey(app));
        body.put("isEmulator", DeviceIdentity.isEmulator());
        body.put("deviceClass", DeviceIdentity.deviceClass());
        body.put("requestAt", requestAt);
        body.put("reason", reason);
        body.put("customerDisplay", DisplayProbe.customerDisplayStatus(app));
        body.put("displays", displayJson);
        body.put("capturedAt", System.currentTimeMillis());
        body.put(
                "captureConsent",
                CaptureProjectionService.hasLiveProjection()
                        ? "live"
                        : CaptureProjectionPrefs.consentState(app));

        if (primary != null) {
            JSONObject p = new JSONObject();
            p.put("role", "primary");
            p.put("ok", primary.ok);
            p.put("detail", primary.detail);
            p.put("width", primary.width);
            p.put("height", primary.height);
            if (primary.ok && primary.jpegBase64 != null) p.put("jpegBase64", primary.jpegBase64);
            body.put("primary", p);
        }
        if (secondary != null) {
            JSONObject s = new JSONObject();
            s.put("role", "secondary");
            s.put("ok", secondary.ok);
            s.put("detail", secondary.detail);
            s.put("width", secondary.width);
            s.put("height", secondary.height);
            if (secondary.ok && secondary.jpegBase64 != null) {
                s.put("jpegBase64", secondary.jpegBase64);
            }
            body.put("secondary", s);
        }

        JSONObject res = postJson(body);
        CapturePrefs.setLastCaptureAt(app, System.currentTimeMillis());
        if (requestAt > 0) CapturePrefs.setLastAckRequestAt(app, requestAt);
        boolean hasImages = res != null && res.optBoolean("hasImages", false);
        String shotId = res != null ? res.optString("shotId", "") : "";
        String urlHint =
                res != null && res.optString("primaryUrl", "").length() > 8
                        ? "url=yes"
                        : "url=no";
        if (hasImages) {
            OpsLogger.info(
                    app,
                    "display",
                    "ส่งแคปจอแล้ว",
                    reason
                            + " · shot="
                            + shotId
                            + " · "
                            + urlHint
                            + " · หลัก="
                            + (primary != null && primary.ok)
                            + " · สอง="
                            + (secondary != null && secondary.ok)
                            + " · "
                            + (primary != null ? primary.detail : ""));
        } else {
            OpsLogger.warn(
                    app,
                    "display",
                    "แคปจอไม่มีรูปบนเซิร์ฟเวอร์",
                    reason
                            + " · shot="
                            + shotId
                            + " · หลัก="
                            + (primary != null && primary.ok)
                            + " · สอง="
                            + (secondary != null && secondary.ok)
                            + " · "
                            + (primary != null ? primary.detail : "")
                            + " · "
                            + (secondary != null ? secondary.detail : ""));
        }
    }

    private static JSONObject displayToJson(DisplayProbe.DisplayInfo d) throws Exception {
        JSONObject o = new JSONObject();
        o.put("number", d.number);
        o.put("displayId", d.display.getDisplayId());
        o.put("primary", d.primary);
        o.put("name", d.name);
        o.put("widthPx", d.widthPx);
        o.put("heightPx", d.heightPx);
        o.put("densityDpi", d.densityDpi);
        o.put("refreshHz", d.refreshHz);
        o.put("rotation", d.rotation);
        o.put("orientation", d.orientation);
        return o;
    }

    private static CaptureShot capturePrimary(Context app) {
        // 1) Real screen via MediaProjection (fixes green placeholder / background cases).
        if (CaptureProjectionService.hasLiveProjection()) {
            try {
                Bitmap proj = CaptureProjectionService.grabPrimary(2500);
                CaptureShot shot = acceptRealFrame(proj, "media_projection");
                if (shot != null) return shot;
            } catch (Exception e) {
                OpsLogger.warn(
                        app,
                        "display",
                        "แคปจอ · MediaProjection ล้ม ใช้ fallback",
                        e.getMessage() == null ? "" : e.getMessage());
            }
        }

        Activity activity = NposApp.foregroundActivity();
        if (activity == null) {
            return CaptureShot.fail("app_background · ไม่มีหน้าจอ foreground");
        }
        if (Build.VERSION.SDK_INT < 26) {
            return CaptureShot.fail("api_lt_26");
        }
        try {
            Bitmap bmp = pixelCopyWindow(activity.getWindow(), 2500);
            if (bmp == null) {
                bmp = drawDecorBitmap(activity);
            }
            CaptureShot shot = acceptRealFrame(bmp, bmp != null ? "pixelcopy" : null);
            if (shot != null) return shot;
            return CaptureShot.fail("pixelcopy_null");
        } catch (Exception e) {
            try {
                Bitmap fallback = drawDecorBitmap(activity);
                CaptureShot shot = acceptRealFrame(fallback, "draw_decor");
                if (shot != null) return shot;
            } catch (Exception ignored) {
                /* fall through */
            }
            return CaptureShot.fail(
                    e.getMessage() == null ? "primary_fail" : e.getMessage());
        }
    }

    /**
     * Encode only real UI frames. Reject near-uniform brand-green placeholders so BO never
     * mistakes a synthetic status card for a live screen.
     */
    private static CaptureShot acceptRealFrame(Bitmap bmp, String detail) {
        if (bmp == null) return null;
        if (isMostlyBrandGreen(bmp)) {
            bmp.recycle();
            return CaptureShot.fail("reject_uniform_green");
        }
        CaptureShot shot = encode(bmp);
        if (detail != null && !detail.isEmpty()) shot.detail = detail;
        return shot;
    }

    /**
     * Reject flat synthetic / empty green placeholders — not normal brand UI.
     * Real sell/customer screens are green-tinted but have enough luminance variance.
     */
    private static boolean isMostlyBrandGreen(Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        if (w < 8 || h < 8) return true;
        int samples = 0;
        int greenish = 0;
        long sum = 0;
        long sumSq = 0;
        int stepX = Math.max(1, w / 12);
        int stepY = Math.max(1, h / 12);
        for (int y = stepY / 2; y < h; y += stepY) {
            for (int x = stepX / 2; x < w; x += stepX) {
                int c = bmp.getPixel(x, y);
                int r = (c >> 16) & 0xff;
                int g = (c >> 8) & 0xff;
                int b = c & 0xff;
                int yv = (r * 30 + g * 59 + b * 11) / 100;
                sum += yv;
                sumSq += (long) yv * yv;
                samples++;
                // Brand ink ~ #1A2E24 / #102018 / #0F1A14 — dark green, low chroma.
                if (g >= r && g >= b && g < 80 && r < 55 && b < 55) {
                    greenish++;
                }
            }
        }
        if (samples <= 0) return true;
        double mean = sum / (double) samples;
        double var = sumSq / (double) samples - mean * mean;
        boolean flat = var < 40.0; // placeholder cards are nearly flat
        return flat && greenish * 100 / samples >= 90;
    }

    private static Bitmap drawDecorBitmap(Activity activity) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Bitmap> out = new AtomicReference<>();
        MAIN.post(
                () -> {
                    try {
                        View root = activity.getWindow().getDecorView();
                        int w = Math.max(1, root.getWidth());
                        int h = Math.max(1, root.getHeight());
                        if (w <= 1 || h <= 1) {
                            out.set(null);
                            return;
                        }
                        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bmp);
                        root.draw(canvas);
                        out.set(bmp);
                    } catch (Exception e) {
                        out.set(null);
                    } finally {
                        latch.countDown();
                    }
                });
        latch.await(2, TimeUnit.SECONDS);
        return out.get();
    }

    private static CaptureShot captureSecondary(Context app) {
        DisplayProbe.DisplayInfo sec = DisplayProbe.secondaryOrNull(app);
        if (sec == null) {
            return CaptureShot.fail("missing");
        }
        if (Build.VERSION.SDK_INT < 26) {
            return CaptureShot.fail("api_lt_26");
        }
        try {
            // Prefer live customer UI (full detail) — never overwrite with probe if showing.
            Bitmap live = captureLiveCustomerOrNull();
            CaptureShot liveShot = acceptRealFrame(live, "live_customer");
            if (liveShot != null) return liveShot;

            Context ui = NposApp.foregroundActivity();
            if (ui == null) ui = app;
            Bitmap bmp = showProbeAndCopy(ui, sec.display, sec);
            CaptureShot shot = acceptRealFrame(bmp, "probe_fallback");
            if (shot != null) return shot;
            return CaptureShot.fail("secondary_copy_null");
        } catch (Exception e) {
            return CaptureShot.fail(e.getMessage() == null ? "secondary_fail" : e.getMessage());
        }
    }

    private static Bitmap captureLiveCustomerOrNull() throws Exception {
        CustomerDisplayPresentation live = CustomerDisplayController.activePresentationOrNull();
        if (live == null) return null;
        Window window = live.getWindow();
        if (window == null) return null;
        Bitmap bmp = pixelCopyWindow(window, 2500);
        if (bmp == null) {
            bmp = drawViewBitmap(live);
        }
        return bmp;
    }

    private static Bitmap showProbeAndCopy(
            Context ui, Display display, DisplayProbe.DisplayInfo info) throws Exception {
        CountDownLatch shown = new CountDownLatch(1);
        AtomicReference<Presentation> ref = new AtomicReference<>();
        AtomicReference<Exception> err = new AtomicReference<>();
        MAIN.post(
                () -> {
                    try {
                        Presentation p =
                                new Presentation(ui, display) {
                                    @Override
                                    protected void onCreate(android.os.Bundle savedInstanceState) {
                                        super.onCreate(savedInstanceState);
                                        setContentView(R.layout.presentation_capture_probe);
                                        TextView title = findViewById(R.id.captureProbeTitle);
                                        TextView body = findViewById(R.id.captureProbeBody);
                                        TextView meta = findViewById(R.id.captureProbeMeta);
                                        title.setText("จอลูกค้า · แคปทดสอบ");
                                        body.setText(
                                                info.sizeLabel()
                                                        + " · "
                                                        + info.orientation
                                                        + " · rot "
                                                        + info.rotation);
                                        meta.setText(
                                                "dpi "
                                                        + info.densityDpi
                                                        + " · id "
                                                        + display.getDisplayId());
                                    }
                                };
                        p.show();
                        ref.set(p);
                    } catch (Exception e) {
                        err.set(e);
                    } finally {
                        shown.countDown();
                    }
                });
        if (!shown.await(3, TimeUnit.SECONDS)) {
            throw new IllegalStateException("show_timeout");
        }
        if (err.get() != null) throw err.get();
        Presentation presentation = ref.get();
        if (presentation == null) throw new IllegalStateException("no_presentation");

        // Let first frame paint.
        Thread.sleep(350);
        try {
            Window window = presentation.getWindow();
            if (window == null) throw new IllegalStateException("no_window");
            Bitmap bmp = pixelCopyWindow(window, 2500);
            if (bmp == null) {
                bmp = drawViewBitmap(presentation);
            }
            return bmp;
        } finally {
            MAIN.post(
                    () -> {
                        try {
                            presentation.dismiss();
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                    });
        }
    }

    private static Bitmap drawViewBitmap(Presentation presentation) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Bitmap> out = new AtomicReference<>();
        MAIN.post(
                () -> {
                    try {
                        View root = presentation.getWindow().getDecorView();
                        int w = Math.max(1, root.getWidth());
                        int h = Math.max(1, root.getHeight());
                        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bmp);
                        root.draw(canvas);
                        out.set(bmp);
                    } catch (Exception e) {
                        out.set(null);
                    } finally {
                        latch.countDown();
                    }
                });
        latch.await(2, TimeUnit.SECONDS);
        return out.get();
    }

    private static Bitmap pixelCopyWindow(Window window, long timeoutMs) throws Exception {
        View decor = window.getDecorView();
        int w = decor.getWidth();
        int h = decor.getHeight();
        if (w <= 0 || h <= 0) {
            CountDownLatch layout = new CountDownLatch(1);
            MAIN.post(
                    () -> {
                        decor.post(layout::countDown);
                    });
            layout.await(1, TimeUnit.SECONDS);
            w = decor.getWidth();
            h = decor.getHeight();
        }
        if (w <= 0 || h <= 0) return null;

        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Integer> result = new AtomicReference<>(-1);
        MAIN.post(
                () -> {
                    try {
                        android.view.PixelCopy.request(
                                window,
                                bitmap,
                                copyResult -> {
                                    result.set(copyResult);
                                    latch.countDown();
                                },
                                MAIN);
                    } catch (Exception e) {
                        result.set(-2);
                        latch.countDown();
                    }
                });
        if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
            return null;
        }
        Integer code = result.get();
        if (code == null || code != android.view.PixelCopy.SUCCESS) {
            return null;
        }
        return bitmap;
    }

    private static CaptureShot encode(Bitmap src) {
        Bitmap scaled = scaleDown(src, MAX_EDGE);
        if (scaled != src) {
            src.recycle();
        }
        int w = scaled.getWidth();
        int h = scaled.getHeight();
        byte[] bytes = compressJpegUnder(scaled, JPEG_QUALITY, MAX_JPEG_BYTES);
        scaled.recycle();
        CaptureShot shot = new CaptureShot();
        shot.ok = true;
        shot.detail = "ok";
        shot.width = w;
        shot.height = h;
        shot.jpegBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
        return shot;
    }

    /** Prefer high quality; step down only if the frame is still huge. */
    private static byte[] compressJpegUnder(Bitmap bmp, int startQuality, int maxBytes) {
        int q = Math.min(95, Math.max(50, startQuality));
        byte[] best = null;
        while (q >= 50) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, q, bos);
            best = bos.toByteArray();
            if (best.length <= maxBytes) return best;
            q -= 8;
        }
        return best == null ? new byte[0] : best;
    }

    private static Bitmap scaleDown(Bitmap src, int maxEdge) {
        int w = src.getWidth();
        int h = src.getHeight();
        int edge = Math.max(w, h);
        if (edge <= maxEdge) return src;
        float scale = maxEdge / (float) edge;
        int nw = Math.max(1, Math.round(w * scale));
        int nh = Math.max(1, Math.round(h * scale));
        return Bitmap.createScaledBitmap(src, nw, nh, true);
    }

    private static JSONObject postJson(JSONObject body) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(REPORT_URL).openConnection();
            conn.setConnectTimeout(20_000);
            conn.setReadTimeout(90_000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bytes);
            }
            int code = conn.getResponseCode();
            InputStream stream =
                    code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String raw = readAll(stream);
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("HTTP " + code + (raw.isEmpty() ? "" : ": " + raw));
            }
            if (raw == null || raw.isEmpty()) return new JSONObject();
            try {
                return new JSONObject(raw);
            } catch (Exception parseErr) {
                return new JSONObject();
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private static final class CaptureShot {
        boolean ok;
        String detail = "";
        int width;
        int height;
        String jpegBase64;

        static CaptureShot fail(String detail) {
            CaptureShot s = new CaptureShot();
            s.ok = false;
            s.detail = detail == null ? "fail" : detail;
            return s;
        }
    }
}
