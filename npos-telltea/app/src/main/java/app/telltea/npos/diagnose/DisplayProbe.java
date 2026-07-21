package app.telltea.npos.diagnose;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.view.Display;

import java.util.ArrayList;
import java.util.List;

/** Lists Android displays and assigns stable 1-based numbers. */
public final class DisplayProbe {
    public static final class DisplayInfo {
        public final int number;
        public final Display display;
        public final boolean primary;
        public final String name;

        public DisplayInfo(int number, Display display, boolean primary, String name) {
            this.number = number;
            this.display = display;
            this.primary = primary;
            this.name = name;
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
            out.add(new DisplayInfo(n++, display, primary, name.trim()));
        }
        return out;
    }
}
