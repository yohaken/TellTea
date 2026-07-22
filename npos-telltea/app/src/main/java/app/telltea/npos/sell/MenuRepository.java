package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.OpsLogger;

public final class MenuRepository {
    public static final String MENU_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposMenuSnapshot";
    public static final String SHOP_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposShopSettings";
    public static final String TOGGLE_SOLD_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposToggleSoldOut";
    public static final String REORDER_CAT_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposReorderCategories";

    private static final String PREFS = "npos_menu";
    private static final String KEY_MENU = "menuJson";
    private static final String KEY_SHOP = "shopJson";

    public interface MenuCallback {
        void onReady(MenuModels.Bundle bundle);
    }

    public interface ShopCallback {
        void onReady(JSONObject shop);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public void loadMenu(Context context, boolean forceNetwork, MenuCallback callback) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    MenuModels.Bundle cached = readCachedMenu(app);
                    // Local-first: always paint from disk cache immediately when present.
                    if (cached != null) {
                        callback.onReady(cached);
                    }
                    try {
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        JSONObject res = postJson(MENU_URL, body);
                        if (res.optBoolean("ok", false)) {
                            String nextRaw = res.toString();
                            String prevRaw =
                                    app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                            .getString(KEY_MENU, null);
                            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .edit()
                                    .putString(KEY_MENU, nextRaw)
                                    .putLong("menuSavedAt", System.currentTimeMillis())
                                    .apply();
                            // Smooth: skip UI churn when snapshot unchanged.
                            if (prevRaw == null || !prevRaw.equals(nextRaw) || forceNetwork) {
                                callback.onReady(MenuModels.fromJson(res));
                            }
                            OpsLogger.info(
                                    app,
                                    "menu",
                                    "ซิงก์เมนูแล้ว",
                                    "items="
                                            + (res.optJSONArray("items") == null
                                                    ? 0
                                                    : res.optJSONArray("items").length()));
                            return;
                        }
                        throw new IllegalStateException(res.optString("error", "menu_failed"));
                    } catch (Exception e) {
                        OpsLogger.warn(
                                app,
                                "menu",
                                "โหลดเมนูไม่สำเร็จ — ใช้แคช/เดโม",
                                e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                        if (cached == null) {
                            callback.onReady(MenuModels.demoBundle());
                        }
                    }
                });
    }

    public void loadShop(Context context, ShopCallback callback) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    JSONObject cached = readCachedShop(app);
                    if (cached != null) callback.onReady(cached);
                    try {
                        JSONObject res = postJson(SHOP_URL, new JSONObject());
                        if (res.optBoolean("ok", false)) {
                            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .edit()
                                    .putString(KEY_SHOP, res.toString())
                                    .apply();
                            callback.onReady(res);
                            return;
                        }
                    } catch (Exception e) {
                        OpsLogger.warn(
                                app,
                                "menu",
                                "โหลดตั้งค่าร้านไม่สำเร็จ",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (cached == null) {
                        try {
                            JSONObject fallback = new JSONObject();
                            fallback.put("ok", true);
                            fallback.put("shopName", "TellTea");
                            fallback.put("promptPayId", "");
                            fallback.put("autoPrintReceipt", true);
                            callback.onReady(fallback);
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                    }
                });
    }

    public interface ToggleCallback {
        void onDone(boolean ok, boolean active, String error);
    }

    /** soldOut=true → active=false (ของหมด). */
    public void toggleSoldOut(Context context, String itemId, boolean soldOut, ToggleCallback cb) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        body.put("itemId", itemId);
                        body.put("soldOut", soldOut);
                        JSONObject res = postJson(TOGGLE_SOLD_URL, body);
                        boolean ok = res.optBoolean("ok", false);
                        if (ok) {
                            OpsLogger.info(
                                    app,
                                    "menu",
                                    soldOut ? "ตั้งของหมด" : "เปิดขายอีกครั้ง",
                                    itemId);
                            if (cb != null) cb.onDone(true, res.optBoolean("active", !soldOut), null);
                        } else {
                            String err = res.optString("error", "toggle_failed");
                            OpsLogger.warn(app, "menu", "ตั้งของหมดไม่สำเร็จ", err);
                            if (cb != null) cb.onDone(false, !soldOut, err);
                        }
                    } catch (Exception e) {
                        String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                        OpsLogger.warn(app, "menu", "ตั้งของหมดไม่สำเร็จ", msg);
                        if (cb != null) cb.onDone(false, !soldOut, msg);
                    }
                });
    }

    /** Persist category order to Firestore (best-effort). Local order already applied. */
    public void reorderCategories(Context context, java.util.List<MenuModels.Category> categories) {
        if (categories == null || categories.isEmpty()) return;
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        org.json.JSONArray ids = new org.json.JSONArray();
                        for (MenuModels.Category c : categories) ids.put(c.id);
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        body.put("categoryIds", ids);
                        JSONObject res = postJson(REORDER_CAT_URL, body);
                        if (res.optBoolean("ok", false)) {
                            OpsLogger.info(app, "menu", "เรียงหมวดแล้ว", "n=" + ids.length());
                        } else {
                            OpsLogger.warn(app, "menu", "เรียงหมวดเซิร์ฟเวอร์ไม่สำเร็จ", res.optString("error"));
                        }
                    } catch (Exception e) {
                        OpsLogger.warn(
                                app,
                                "menu",
                                "เรียงหมวดออฟไลน์ — เก็บในเครื่องแล้ว",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    private static MenuModels.Bundle readCachedMenu(Context app) {
        String raw = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MENU, null);
        if (raw == null) return null;
        try {
            return MenuModels.fromJson(new JSONObject(raw));
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject readCachedShop(Context app) {
        String raw = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SHOP, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static JSONObject postJson(String url, JSONObject body) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        try {
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(20_000);
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
                throw new IllegalStateException("HTTP " + code + " " + raw);
            }
            return new JSONObject(raw.isEmpty() ? "{}" : raw);
        } finally {
            conn.disconnect();
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
}
