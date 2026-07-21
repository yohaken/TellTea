package app.telltea.npos.sell;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import app.telltea.npos.diagnose.DeviceIdentity;
import app.telltea.npos.diagnose.OpsLogger;
import app.telltea.npos.printer.EscPos;
import app.telltea.npos.printer.PrinterEndpoint;
import app.telltea.npos.printer.PrinterPrefs;
import app.telltea.npos.printer.PrinterTransport;
import app.telltea.npos.shift.ShiftPrefs;

/** Local-first sale outbox + flush to nposCompleteSale + optional print/drawer. */
public final class SaleSync {
    public static final String SALE_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposCompleteSale";
    public static final String OPEN_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposSessionOpen";
    public static final String CLOSE_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposSessionClose";

    private static final String PREFS = "npos_outbox";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_RECEIPTS = "receipts";

    public interface SaleCallback {
        void onLocalSaved(String localId, double total);

        void onSynced(String billNo, double change, double total);

        void onError(String humanMessage);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final PrinterTransport transport = new PrinterTransport();

    public void openSession(Context context, Runnable done) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        long openedAt = System.currentTimeMillis();
                        String sessionId = DeviceIdentity.getOrCreateInstallId(app) + "_" + openedAt;
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        body.put("sessionId", sessionId);
                        JSONObject res = MenuRepository.postJson(OPEN_URL, body);
                        if (res.optBoolean("ok", false)) {
                            ShiftPrefs.open(app, sessionId, res.optString("shift", "morning"), openedAt);
                            OpsLogger.info(app, "shift", "เปิดรอบแล้ว", sessionId);
                        } else {
                            ShiftPrefs.open(app, sessionId, "morning", openedAt);
                            OpsLogger.warn(app, "shift", "เปิดรอบออฟไลน์", res.optString("error"));
                        }
                    } catch (Exception e) {
                        long openedAt = System.currentTimeMillis();
                        String sessionId = DeviceIdentity.getOrCreateInstallId(app) + "_" + openedAt;
                        ShiftPrefs.open(app, sessionId, "morning", openedAt);
                        OpsLogger.warn(
                                app,
                                "shift",
                                "เปิดรอบออฟไลน์",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (done != null) done.run();
                });
    }

    public void closeSession(Context context, Runnable done) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        body.put("sessionId", ShiftPrefs.sessionId(app));
                        body.put("cashTotal", ShiftPrefs.cashTotal(app));
                        body.put("promptpayTotal", ShiftPrefs.promptpayTotal(app));
                        JSONObject res = MenuRepository.postJson(CLOSE_URL, body);
                        if (res.optBoolean("ok", false)) {
                            OpsLogger.info(
                                    app,
                                    "shift",
                                    "ปิดรอบแล้ว",
                                    "sales=" + res.optInt("saleCount") + " total=" + res.optDouble("totalSales"));
                        } else {
                            OpsLogger.warn(app, "shift", "ปิดรอบเซิร์ฟเวอร์ไม่สำเร็จ", res.optString("error"));
                        }
                    } catch (Exception e) {
                        OpsLogger.warn(
                                app,
                                "shift",
                                "ปิดรอบออฟไลน์",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    ShiftPrefs.close(app);
                    if (done != null) done.run();
                });
    }

    public void enqueueSale(
            Context context,
            List<MenuModels.CartLine> lines,
            String paymentMethod,
            double cashReceived,
            double discountBaht,
            JSONObject shop,
            boolean autoPrint,
            SaleCallback callback) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        String mutationId = "npos_" + UUID.randomUUID().toString().replace("-", "");
                        JSONArray lineArr = new JSONArray();
                        double subtotal = 0;
                        for (MenuModels.CartLine line : lines) {
                            JSONObject o = new JSONObject();
                            o.put("menuItemId", line.menuItemId);
                            o.put("name", line.name);
                            o.put("price", line.unitPrice);
                            o.put("qty", line.qty);
                            if (line.optionsJson != null && line.optionsJson.length() > 0) {
                                o.put("options", line.optionsJson);
                            }
                            lineArr.put(o);
                            subtotal += line.lineTotal();
                        }
                        double total = Math.max(0, subtotal - discountBaht);
                        JSONObject payload = new JSONObject();
                        payload.put("clientMutationId", mutationId);
                        payload.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        payload.put("deviceId", DeviceIdentity.getOrCreateInstallId(app));
                        payload.put("sessionId", ShiftPrefs.sessionId(app));
                        payload.put("shift", ShiftPrefs.shift(app));
                        payload.put("lines", lineArr);
                        payload.put("paymentMethod", paymentMethod);
                        payload.put("cashReceived", "cash".equals(paymentMethod) ? cashReceived : 0);
                        payload.put("discountBaht", discountBaht);
                        payload.put("localTotal", total);
                        payload.put("createdAt", System.currentTimeMillis());

                        pushQueue(app, payload);
                        rememberReceipt(app, payload, "รอส่ง");
                        if ("cash".equals(paymentMethod)) {
                            ShiftPrefs.addCash(app, total);
                        } else {
                            ShiftPrefs.addPromptPay(app, total);
                        }
                        if (callback != null) callback.onLocalSaved(mutationId, total);

                        try {
                            flushOne(app, payload, shop, autoPrint, paymentMethod, callback);
                        } catch (Exception syncErr) {
                            OpsLogger.warn(
                                    app,
                                    "sync",
                                    "ซิงก์บิลค้างในคิว",
                                    syncErr.getMessage() == null
                                            ? syncErr.getClass().getSimpleName()
                                            : syncErr.getMessage());
                            if (callback != null) {
                                callback.onError("บันทึกในเครื่องแล้ว — รอซิงก์เมื่อมีเน็ต");
                            }
                        }
                    } catch (Exception e) {
                        OpsLogger.error(
                                app,
                                "sync",
                                "บันทึกบิลไม่สำเร็จ",
                                e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
                        if (callback != null) {
                            callback.onError("บันทึกบิลไม่สำเร็จ — จะลองใหม่เมื่อมีเน็ต");
                        }
                    }
                });
    }

    public void flushPending(Context context) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONArray q = readQueue(app);
                        for (int i = 0; i < q.length(); i++) {
                            flushOne(app, q.getJSONObject(i), null, false, null, null);
                        }
                    } catch (Exception e) {
                        OpsLogger.warn(app, "sync", "flush pending พลาด", e.getMessage() == null ? "" : e.getMessage());
                    }
                });
    }

    public List<JSONObject> recentReceipts(Context context) {
        List<JSONObject> out = new ArrayList<>();
        try {
            JSONArray arr =
                    new JSONArray(
                            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .getString(KEY_RECEIPTS, "[]"));
            for (int i = arr.length() - 1; i >= 0 && out.size() < 40; i--) {
                out.add(arr.getJSONObject(i));
            }
        } catch (Exception ignored) {
            /* empty */
        }
        return out;
    }

    public void shutdown() {
        transport.shutdown();
        executor.shutdownNow();
    }

    private void flushOne(
            Context app,
            JSONObject payload,
            JSONObject shop,
            boolean autoPrint,
            String paymentMethod,
            SaleCallback callback)
            throws Exception {
        JSONObject res = MenuRepository.postJson(SALE_URL, payload);
        if (!res.optBoolean("ok", false)) {
            throw new IllegalStateException(res.optString("error", "sale_failed"));
        }
        String billNo = res.optString("billNo", "—");
        double change = res.optDouble("change", 0);
        double total = res.optDouble("total", payload.optDouble("localTotal", 0));
        removeFromQueue(app, payload.optString("clientMutationId"));
        updateReceiptBill(app, payload.optString("clientMutationId"), billNo);
        OpsLogger.info(app, "sync", "ซิงก์บิลแล้ว", billNo + " · " + total);
        if (callback != null) callback.onSynced(billNo, change, total);

        boolean print = autoPrint;
        if (shop != null) print = shop.optBoolean("autoPrintReceipt", true);
        if (print) {
            maybePrintAndKick(app, payload, billNo, total, paymentMethod == null
                    ? payload.optString("paymentMethod")
                    : paymentMethod);
        }
    }

    private void maybePrintAndKick(
            Context app, JSONObject payload, String billNo, double total, String paymentMethod) {
        PrinterEndpoint ep = PrinterPrefs.savedOrNull(app);
        if (ep == null) {
            OpsLogger.warn(app, "printer", "ข้ามพิมพ์ — ยังไม่เลือกปริ้นเตอร์", billNo);
            return;
        }
        String shopName = "TellTea";
        try {
            String raw = app.getSharedPreferences("npos_menu", Context.MODE_PRIVATE).getString("shopJson", null);
            if (raw != null) shopName = new JSONObject(raw).optString("shopName", shopName);
        } catch (Exception ignored) {
            /* ignore */
        }
        StringBuilder text = new StringBuilder();
        text.append(shopName).append("\n");
        text.append("บิล ").append(billNo).append("\n");
        try {
            JSONArray lines = payload.getJSONArray("lines");
            for (int i = 0; i < lines.length(); i++) {
                JSONObject l = lines.getJSONObject(i);
                text.append(l.optString("name"))
                        .append(" x")
                        .append(l.optInt("qty"))
                        .append("\n");
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        text.append("รวม ").append(String.format(java.util.Locale.US, "%.0f", total)).append("\n");
        byte[] receipt = EscPos.saleReceipt(text.toString());
        transport.send(
                app,
                ep,
                receipt,
                result -> {
                    if (result.ok) {
                        OpsLogger.result(app, "printer", "พิมพ์ใบเสร็จแล้ว", billNo, true);
                        if ("cash".equals(paymentMethod)) {
                            transport.send(
                                    app,
                                    ep,
                                    EscPos.drawerKick(),
                                    kick ->
                                            OpsLogger.result(
                                                    app,
                                                    "drawer",
                                                    kick.ok ? "เปิดลิ้นชักหลังขาย" : "ลิ้นชักไม่เปิด",
                                                    kick.message,
                                                    kick.ok));
                        }
                    } else {
                        OpsLogger.error(app, "printer", "พิมพ์ใบเสร็จไม่สำเร็จ", result.message);
                    }
                });
    }

    private static void pushQueue(Context app, JSONObject payload) throws Exception {
        JSONArray q = readQueue(app);
        q.put(payload);
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_QUEUE, q.toString())
                .apply();
    }

    private static JSONArray readQueue(Context app) throws Exception {
        String raw = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_QUEUE, "[]");
        return new JSONArray(raw);
    }

    private static void removeFromQueue(Context app, String mutationId) throws Exception {
        JSONArray q = readQueue(app);
        JSONArray next = new JSONArray();
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.getJSONObject(i);
            if (!mutationId.equals(o.optString("clientMutationId"))) next.put(o);
        }
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_QUEUE, next.toString())
                .apply();
    }

    private static void rememberReceipt(Context app, JSONObject payload, String billNo) throws Exception {
        JSONArray arr =
                new JSONArray(
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECEIPTS, "[]"));
        JSONObject row = new JSONObject();
        row.put("at", System.currentTimeMillis());
        row.put("mutationId", payload.optString("clientMutationId"));
        row.put("billNo", billNo);
        row.put("total", payload.optDouble("localTotal"));
        row.put("paymentMethod", payload.optString("paymentMethod"));
        row.put("lines", payload.optJSONArray("lines"));
        arr.put(row);
        while (arr.length() > 60) {
            JSONArray trimmed = new JSONArray();
            for (int i = 1; i < arr.length(); i++) trimmed.put(arr.get(i));
            arr = trimmed;
        }
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_RECEIPTS, arr.toString())
                .apply();
    }

    private static void updateReceiptBill(Context app, String mutationId, String billNo) throws Exception {
        JSONArray arr =
                new JSONArray(
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECEIPTS, "[]"));
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            if (mutationId.equals(o.optString("mutationId"))) {
                o.put("billNo", billNo);
            }
        }
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_RECEIPTS, arr.toString())
                .apply();
    }
}
