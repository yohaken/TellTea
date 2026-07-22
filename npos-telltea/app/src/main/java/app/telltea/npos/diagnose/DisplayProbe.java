package app.telltea.npos.diagnose;

import android.content.Context;
import android.content.res.Configuration;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Surface;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Lists Android displays with size / orientation for back-office diagnose. */
public final class DisplayProbe {
    public static final class DisplayInfo {
        public final int number;
        public final Display display;
        public final boolean primary;
        public final String name;
        public final int widthPx;
        public final int heightPx;
        public final int densityDpi;
        public final float refreshHz;
        public final int rotation;
        /** portrait | landscape | unknown */
        public final String orientation;

        public DisplayInfo(
                int number,
                Display display,
                boolean primary,
                String name,
                int widthPx,
                int heightPx,
                int densityDpi,
                float refreshHz,
                int rotation,
                String orientation) {
            this.number = number;
            this.display = display;
            this.primary = primary;
            this.name = name;
            this.widthPx = widthPx;
            this.heightPx = heightPx;
            this.densityDpi = densityDpi;
            this.refreshHz = refreshHz;
            this.rotation = rotation;
            this.orientation = orientation;
        }

        public String sizeLabel() {
            return widthPx + "x" + heightPx;
        }
    }

    private DisplayProbe() {}

    public static List<DisplayInfo> listDisplays(Context context) {
        DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        List<DisplayInfo> out = new ArrayList<>();
        if (dm == null) return out;

        Display[] displays = dm.getDisplays();
        Display defaultDisplay = null;
        try {
            defaultDisplay = dm.getDisplay(Display.DEFAULT_DISPLAY);
        } catch (Exception ignored) {
            /* older / odd devices */
        }

        int n = 1;
        for (Display display : displays) {
            if (display == null) continue;
            boolean primary =
                    defaultDisplay != null
                            ? display.getDisplayId() == defaultDisplay.getDisplayId()
                            : display.getDisplayId() == Display.DEFAULT_DISPLAY;
            String name = display.getName();
            if (name == null || name.trim().isEmpty()) {
                name = "display-" + display.getDisplayId();
            }

            DisplayMetrics metrics = new DisplayMetrics();
            try {
                display.getRealMetrics(metrics);
            } catch (Exception e) {
                display.getMetrics(metrics);
            }
            int w = Math.max(0, metrics.widthPixels);
            int h = Math.max(0, metrics.heightPixels);
            int dpi = metrics.densityDpi;
            float hz = 0f;
            if (Build.VERSION.SDK_INT >= 23) {
                try {
                    hz = display.getRefreshRate();
                } catch (Exception ignored) {
                    hz = 0f;
                }
            }
            int rotation = Surface.ROTATION_0;
            try {
                rotation = display.getRotation();
            } catch (Exception ignored) {
                /* default */
            }
            String orientation = orientationOf(w, h, context, primary);

            out.add(
                    new DisplayInfo(
                            n++,
                            display,
                            primary,
                            name.trim(),
                            w,
                            h,
                            dpi,
                            hz,
                            rotationDegrees(rotation),
                            orientation));
        }
        return out;
    }

    public static DisplayInfo secondaryOrNull(Context context) {
        for (DisplayInfo d : listDisplays(context)) {
            if (!d.primary) return d;
        }
        return null;
    }

    /** ok | missing — customer display presence. */
    public static String customerDisplayStatus(Context context) {
        return secondaryOrNull(context) == null ? "missing" : "ok";
    }

    private static int rotationDegrees(int surfaceRotation) {
        switch (surfaceRotation) {
            case Surface.ROTATION_90:
                return 90;
            case Surface.ROTATION_180:
                return 180;
            case Surface.ROTATION_270:
                return 270;
            default:
                return 0;
        }
    }

    private static String orientationOf(int w, int h, Context context, boolean primary) {
        if (w > 0 && h > 0) {
            return w >= h ? "landscape" : "portrait";
        }
        if (primary) {
            int orient = context.getResources().getConfiguration().orientation;
            if (orient == Configuration.ORIENTATION_LANDSCAPE) return "landscape";
            if (orient == Configuration.ORIENTATION_PORTRAIT) return "portrait";
        }
        return "unknown";
    }

    public static String summarize(List<DisplayInfo> displays) {
        if (displays == null || displays.isEmpty()) return "จอ 0";
        StringBuilder sb = new StringBuilder();
        sb.append("จอ ").append(displays.size());
        for (DisplayInfo d : displays) {
            sb.append(
                    String.format(
                            Locale.US,
                            " · #%d %s %s %s",
                            d.number,
                            d.primary ? "หลัก" : "ลูกค้า",
                            d.sizeLabel(),
                            d.orientation));
        }
        return sb.toString();
    }
}
