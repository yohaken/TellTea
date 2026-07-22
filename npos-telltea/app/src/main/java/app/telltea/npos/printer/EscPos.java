package app.telltea.npos.printer;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Minimal ESC/POS helpers for test page + cash-drawer kick. */
public final class EscPos {
    private EscPos() {}

    /** ESC p m t1 t2 — pulse drawer pin 2 (common default). */
    public static byte[] drawerKick() {
        return new byte[] {0x1B, 0x70, 0x00, 0x19, (byte) 0xFA};
    }

    public static byte[] testReceipt(String versionName, int versionCode, String endpointLabel) {
        List<byte[]> parts = new ArrayList<>();
        parts.add(new byte[] {0x1B, 0x40}); // init
        parts.add(new byte[] {0x1B, 0x61, 0x01}); // center
        parts.add(text("nPos-telltea\n"));
        parts.add(text("TEST PRINT (N4)\n"));
        parts.add(new byte[] {0x1B, 0x61, 0x00}); // left
        parts.add(text("----------------\n"));
        parts.add(text("ver " + safe(versionName) + " (" + versionCode + ")\n"));
        parts.add(text("via " + safe(endpointLabel) + "\n"));
        parts.add(text("ok if this paper prints\n"));
        parts.add(text("----------------\n\n\n"));
        parts.add(new byte[] {0x1D, 0x56, 0x00}); // full cut (many ignore harmlessly)
        return concat(parts);
    }

    /**
     * Legacy wrapper for Z/X reports — centered TellTea brand then body.
     * Customer receipts should use {@link #documentReceipt(String)} (full form in body).
     */
    public static byte[] saleReceipt(String body) {
        List<byte[]> parts = new ArrayList<>();
        parts.add(new byte[] {0x1B, 0x40});
        parts.add(new byte[] {0x1B, 0x61, 0x01});
        parts.add(text("TellTea\n"));
        parts.add(new byte[] {0x1B, 0x61, 0x00});
        parts.add(text("----------------\n"));
        parts.add(text(body == null ? "" : body));
        if (body == null || !body.endsWith("\n")) parts.add(text("\n"));
        parts.add(text("----------------\n\n\n"));
        parts.add(new byte[] {0x1D, 0x56, 0x00});
        return concat(parts);
    }

    /**
     * Full customer receipt document — body already includes shop/bill/totals
     * (see {@link ReceiptFormBuilder}). No extra brand header.
     */
    public static byte[] documentReceipt(String body) {
        List<byte[]> parts = new ArrayList<>();
        parts.add(new byte[] {0x1B, 0x40}); // init
        parts.add(new byte[] {0x1B, 0x61, 0x00}); // left (builder centers with spaces)
        parts.add(text(body == null ? "" : body));
        if (body == null || !body.endsWith("\n")) parts.add(text("\n"));
        parts.add(text("\n\n"));
        parts.add(new byte[] {0x1D, 0x56, 0x00}); // full cut
        return concat(parts);
    }

    private static String safe(String s) {
        if (s == null || s.trim().isEmpty()) return "-";
        String t = s.trim();
        return t.length() > 40 ? t.substring(0, 40) : t;
    }

    private static byte[] text(String s) {
        // Prefer TIS-620 when available; fall back to ASCII-ish UTF-8 bytes.
        try {
            Charset tis = Charset.forName("TIS-620");
            return s.getBytes(tis);
        } catch (Exception e) {
            return s.getBytes(StandardCharsets.UTF_8);
        }
    }

    private static byte[] concat(List<byte[]> parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int o = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, o, p.length);
            o += p.length;
        }
        return out;
    }
}
