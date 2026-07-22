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
import app.telltea.npos.printer.ReceiptFormBuilder;
import app.telltea.npos.shift.BlindCloseReport;
import app.telltea.npos.shift.ShiftPrefs;

/**
 * Local-first sale outbox + flush to nposCompleteSale + optional print/drawer.
 * W4: queue rows carry status / attempts / lastError; void drops unsynced rows.
 * W5: synced voids call nposVoidSale (with offline void queue).
 */
public final class SaleSync {
    public static final String SALE_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposCompleteSale";
    public static final String VOID_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposVoidSale";
    public static final String OPEN_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposSessionOpen";
    public static final String CLOSE_URL =
            "https://asia-southeast1-mypeer-501909.cloudfunctions.net/nposSessionClose";

    private static final String PREFS = "npos_outbox";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_VOID_QUEUE = "voidQueue";
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
        closeSession(context, null, done);
    }

    public void closeSession(Context context, BlindCloseReport report, Runnable done) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
                        body.put("sessionId", ShiftPrefs.sessionId(app));
                        body.put("cashTotal", ShiftPrefs.cashTotal(app));
                        body.put("promptpayTotal", ShiftPrefs.promptpayTotal(app));
                        body.put("openingCash", ShiftPrefs.openingCash(app));
                        body.put("discountTotal", ShiftPrefs.discountTotal(app));
                        body.put("voidedCount", ShiftPrefs.voidedCount(app));
                        body.put("saleCount", ShiftPrefs.saleCount(app));
                        if (report != null) {
                            body.put("closingCashCounted", report.countedCash);
                            body.put("expectedCash", report.expectedCash);
                            body.put("cashDifference", report.cashDifference);
                            body.put("leaveFloat", report.leaveFloat);
                            body.put("discrepancyNote", report.discrepancyNote);
                            body.put("discrepancyLabel", report.discrepancyLabel());
                        }
                        JSONObject res = MenuRepository.postJson(CLOSE_URL, body);
                        if (res.optBoolean("ok", false)) {
                            OpsLogger.info(
                                    app,
                                    "shift",
                                    "ปิดรอบแล้ว",
                                    "sales="
                                            + res.optInt("saleCount")
                                            + " total="
                                            + res.optDouble("totalSales")
                                            + (report != null
                                                    ? " diff="
                                                            + String.format(
                                                                    java.util.Locale.US,
                                                                    "%.0f",
                                                                    report.cashDifference)
                                                    : ""));
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
                    if (report != null) {
                        ShiftPrefs.setNextOpeningCash(app, report.leaveFloat);
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
                        payload.put("subtotal", subtotal);
                        payload.put("localTotal", total);
                        payload.put("createdAt", System.currentTimeMillis());
                        if (shop != null) {
                            String staff = shop.optString("receiptStaffName", "").trim();
                            if (!staff.isEmpty()) payload.put("staffName", staff);
                            String footer = shop.optString("receiptFooterNote", "").trim();
                            if (!footer.isEmpty()) payload.put("receiptFooterNote", footer);
                        }
                        ensureOutboxMeta(payload);

                        pushQueue(app, payload);
                        rememberReceipt(app, payload, "รอส่ง");
                        ShiftPrefs.recordSale(app, paymentMethod, total, discountBaht);
                        BestsellerPrefs.recordLines(app, lineArr);
                        if (callback != null) callback.onLocalSaved(mutationId, total);

                        boolean print = autoPrint;
                        if (shop != null) print = shop.optBoolean("autoPrintReceipt", true);

                        try {
                            flushOne(app, payload, shop, print, paymentMethod, callback);
                        } catch (Exception syncErr) {
                            String msg =
                                    syncErr.getMessage() == null
                                            ? syncErr.getClass().getSimpleName()
                                            : syncErr.getMessage();
                            markQueueAttempt(app, mutationId, msg, isPermanentSaleError(msg));
                            OpsLogger.warn(app, "sync", "ซิงก์บิลค้างในคิว", msg);
                            // Offline / sync fail — still give customer paper (provisional #).
                            if (print && !isReceiptPrinted(app, mutationId)) {
                                maybePrintAndKick(
                                        app,
                                        shop,
                                        payload,
                                        provisionalBillNo(mutationId),
                                        total,
                                        paymentMethod);
                                markReceiptPrinted(app, mutationId);
                                try {
                                    payload.put("receiptPrinted", true);
                                } catch (Exception ignored) {
                                    /* ignore */
                                }
                            }
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
                            JSONObject row = q.getJSONObject(i);
                            ensureOutboxMeta(row);
                            if ("failed".equals(row.optString("status"))) continue;
                            try {
                                // Print once if never printed (e.g. was offline at sale time).
                                flushOne(app, row, null, true, null, null);
                            } catch (Exception syncErr) {
                                String msg =
                                        syncErr.getMessage() == null
                                                ? syncErr.getClass().getSimpleName()
                                                : syncErr.getMessage();
                                markQueueAttempt(
                                        app,
                                        row.optString("clientMutationId"),
                                        msg,
                                        isPermanentSaleError(msg));
                            }
                        }
                        flushVoidQueue(app);
                    } catch (Exception e) {
                        OpsLogger.warn(app, "sync", "flush pending พลาด", e.getMessage() == null ? "" : e.getMessage());
                    }
                });
    }

    /** Retry one pending/failed outbox row (clears failed → pending). */
    public void retryPending(Context context, String mutationId, Runnable done) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONObject row = findQueueRow(app, mutationId);
                        if (row != null) {
                            row.put("status", "pending");
                            row.put("lastError", "");
                            writeQueueRow(app, row);
                            // Retry sync — print only if never printed.
                            flushOne(app, row, null, true, null, null);
                        }
                    } catch (Exception e) {
                        try {
                            markQueueAttempt(
                                    app,
                                    mutationId,
                                    e.getMessage() == null ? "retry_failed" : e.getMessage(),
                                    isPermanentSaleError(e.getMessage() == null ? "" : e.getMessage()));
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                        OpsLogger.warn(
                                app,
                                "sync",
                                "retry บิลค้างพลาด",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (done != null) done.run();
                });
    }

    /**
     * Cancel a still-local outbox bill: drop queue row, void local receipt, unrecord shift.
     * Does not call the server (sale never synced).
     */
    public void cancelPending(Context context, String mutationId, Runnable done) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        JSONObject row = findQueueRow(app, mutationId);
                        if (row != null) {
                            removeFromQueue(app, mutationId);
                            markReceiptVoided(app, mutationId, "ยกเลิกบิลรอส่ง");
                            ShiftPrefs.unrecordSale(
                                    app,
                                    row.optString("paymentMethod", ""),
                                    row.optDouble("localTotal", 0),
                                    row.optDouble("discountBaht", 0));
                            BestsellerPrefs.reverseLines(app, row.optJSONArray("lines"));
                            OpsLogger.info(app, "sync", "ยกเลิกบิลรอส่ง", mutationId);
                        }
                    } catch (Exception e) {
                        OpsLogger.error(
                                app,
                                "sync",
                                "ยกเลิกบิลรอส่งไม่สำเร็จ",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (done != null) done.run();
                });
    }

    /** Snapshot of outbox rows for pending UI (newest last). */
    public List<JSONObject> listPending(Context context) {
        List<JSONObject> out = new ArrayList<>();
        try {
            JSONArray q = readQueue(context.getApplicationContext());
            for (int i = 0; i < q.length(); i++) {
                JSONObject row = q.getJSONObject(i);
                ensureOutboxMeta(row);
                out.add(row);
            }
        } catch (Exception ignored) {
            /* empty */
        }
        return out;
    }

    public int failedCount(Context context) {
        int n = 0;
        for (JSONObject row : listPending(context)) {
            if ("failed".equals(row.optString("status"))) n++;
        }
        return n;
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

    public int pendingCount(Context context) {
        try {
            return readQueue(context.getApplicationContext()).length();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Reprint a stored local receipt (N6.6 parity with web PosReceiptsView). */
    public void reprintReceipt(Context context, JSONObject receiptRow, Runnable onDone) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        if (receiptRow.optBoolean("voided", false)) {
                            OpsLogger.warn(app, "printer", "ข้ามพิมพ์ — บิลถูกทำลายแล้ว", receiptRow.optString("billNo"));
                        } else {
                            String billNo = receiptRow.optString("billNo", "—");
                            double total = receiptRow.optDouble("total", 0);
                            String pay = receiptRow.optString("paymentMethod", "");
                            JSONObject payload = new JSONObject();
                            payload.put("lines", receiptRow.optJSONArray("lines"));
                            payload.put("paymentMethod", pay);
                            payload.put("localTotal", total);
                            payload.put("discountBaht", receiptRow.optDouble("discountBaht", 0));
                            payload.put("subtotal", receiptRow.optDouble("subtotal", 0));
                            payload.put("cashReceived", receiptRow.optDouble("cashReceived", 0));
                            payload.put("change", receiptRow.optDouble("change", 0));
                            payload.put(
                                    "createdAt",
                                    receiptRow.optLong("at", System.currentTimeMillis()));
                            payload.put("staffName", receiptRow.optString("staffName", ""));
                            payload.put(
                                    "receiptFooterNote",
                                    receiptRow.optString("receiptFooterNote", ""));
                            JSONObject shop = loadShopJson(app);
                            maybePrintAndKick(app, shop, payload, billNo, total, pay);
                            OpsLogger.info(app, "printer", "พิมพ์ใบเสร็จซ้ำ", billNo);
                        }
                    } catch (Exception e) {
                        OpsLogger.error(
                                app,
                                "printer",
                                "พิมพ์ซ้ำไม่สำเร็จ",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (onDone != null) onDone.run();
                });
    }

    /**
     * Local void + drop unsynced outbox row; if already synced, call nposVoidSale (or queue void).
     */
    public void voidReceipt(Context context, JSONObject receiptRow, String reason, Runnable onDone) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    try {
                        if (receiptRow.optBoolean("voided", false)) {
                            if (onDone != null) onDone.run();
                            return;
                        }
                        String mutationId = receiptRow.optString("mutationId", "");
                        String voidReason =
                                reason == null || reason.isEmpty() ? "ทำลายบิล" : reason;
                        boolean wasPending = findQueueRow(app, mutationId) != null;
                        if (wasPending) {
                            removeFromQueue(app, mutationId);
                        }
                        markReceiptVoided(app, mutationId, voidReason);
                        ShiftPrefs.unrecordSale(
                                app,
                                receiptRow.optString("paymentMethod", ""),
                                receiptRow.optDouble("total", 0),
                                receiptRow.optDouble("discountBaht", 0));
                        BestsellerPrefs.reverseLines(app, receiptRow.optJSONArray("lines"));
                        OpsLogger.info(
                                app,
                                "sale",
                                "ทำลายบิล",
                                receiptRow.optString("billNo", mutationId));
                        if (!wasPending && !mutationId.isEmpty()) {
                            tryServerVoid(
                                    app,
                                    mutationId,
                                    receiptRow.optString("saleId", ""),
                                    voidReason);
                        }
                    } catch (Exception e) {
                        OpsLogger.error(
                                app,
                                "sale",
                                "ทำลายบิลไม่สำเร็จ",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (onDone != null) onDone.run();
                });
    }

    /** kind: "snapshot" (X) or "close" (Z). Snapshot does not close the session. */
    public void printShiftReport(Context context, String kind, Runnable onDone) {
        printShiftReport(context, kind, null, onDone);
    }

    public void printShiftReport(
            Context context, String kind, BlindCloseReport report, Runnable onDone) {
        Context app = context.getApplicationContext();
        final String reportKind = "close".equals(kind) ? "close" : "snapshot";
        executor.execute(
                () -> {
                    try {
                        PrinterEndpoint ep = PrinterPrefs.savedOrNull(app);
                        if (ep == null) {
                            OpsLogger.warn(app, "printer", "ข้ามพิมพ์สรุปรอบ — ยังไม่เลือกปริ้นเตอร์", reportKind);
                        } else {
                            double cash = ShiftPrefs.cashTotal(app);
                            double pp = ShiftPrefs.promptpayTotal(app);
                            double discount = ShiftPrefs.discountTotal(app);
                            double opening = ShiftPrefs.openingCash(app);
                            int sales = ShiftPrefs.saleCount(app);
                            int cashBills = ShiftPrefs.cashBillCount(app);
                            int ppBills = ShiftPrefs.promptpayBillCount(app);
                            int voided = ShiftPrefs.voidedCount(app);
                            String title =
                                    "close".equals(reportKind)
                                            ? "ปิดรอบ / Z-REPORT"
                                            : "Snapshot กลางรอบ / X-REPORT";
                            String footer =
                                    "close".equals(reportKind)
                                            ? "ปิดรอบเรียบร้อย\n"
                                            : "*** ไม่ใช่การปิดรอบ ***\n";
                            StringBuilder sb = new StringBuilder();
                            sb.append(title)
                                    .append("\n")
                                    .append("รอบ ")
                                    .append(ShiftPrefs.shift(app))
                                    .append("\n")
                                    .append("session ")
                                    .append(ShiftPrefs.sessionId(app))
                                    .append("\n")
                                    .append("----------------\n")
                                    .append("บิลขาย ")
                                    .append(sales)
                                    .append("\n")
                                    .append("ทำลายบิล ")
                                    .append(voided)
                                    .append("\n")
                                    .append("เงินสด ")
                                    .append(cashBills)
                                    .append(" บิล · ")
                                    .append(String.format(java.util.Locale.US, "%.0f", cash))
                                    .append("\n")
                                    .append("PromptPay ")
                                    .append(ppBills)
                                    .append(" บิล · ")
                                    .append(String.format(java.util.Locale.US, "%.0f", pp))
                                    .append("\n")
                                    .append("ส่วนลดรวม ")
                                    .append(String.format(java.util.Locale.US, "%.0f", discount))
                                    .append("\n")
                                    .append("----------------\n")
                                    .append("รวมยอดขาย ")
                                    .append(String.format(java.util.Locale.US, "%.0f", cash + pp))
                                    .append("\n");
                            if ("close".equals(reportKind)) {
                                double expected =
                                        report != null ? report.expectedCash : opening + cash;
                                double counted = report != null ? report.countedCash : expected;
                                double diff = report != null ? report.cashDifference : 0;
                                String label =
                                        report != null ? report.discrepancyLabel() : "ตรง";
                                sb.append("----------------\n")
                                        .append("เงินทอนเริ่ม ")
                                        .append(String.format(java.util.Locale.US, "%.0f", opening))
                                        .append("\n")
                                        .append("ควรมีในลิ้นชัก ")
                                        .append(String.format(java.util.Locale.US, "%.0f", expected))
                                        .append("\n")
                                        .append("นับได้ ")
                                        .append(String.format(java.util.Locale.US, "%.0f", counted))
                                        .append("\n")
                                        .append("ส่วนต่าง ")
                                        .append(label)
                                        .append(" ")
                                        .append(String.format(java.util.Locale.US, "%.0f", diff))
                                        .append("\n");
                                if (report != null && report.leaveFloat > 0) {
                                    sb.append("เงินทอนค้างรอบถัดไป ")
                                            .append(
                                                    String.format(
                                                            java.util.Locale.US,
                                                            "%.0f",
                                                            report.leaveFloat))
                                            .append("\n");
                                }
                                if (report != null
                                        && report.discrepancyNote != null
                                        && !report.discrepancyNote.isEmpty()) {
                                    sb.append("เหตุผล ")
                                            .append(report.discrepancyNote)
                                            .append("\n");
                                }
                            }
                            sb.append(footer);
                            transport.send(
                                    app,
                                    ep,
                                    EscPos.saleReceipt(sb.toString()),
                                    result ->
                                            OpsLogger.result(
                                                    app,
                                                    "printer",
                                                    result.ok
                                                            ? ("close".equals(reportKind)
                                                                    ? "พิมพ์ปิดรอบแล้ว"
                                                                    : "พิมพ์สรุปกลางรอบแล้ว")
                                                            : "พิมพ์สรุปรอบไม่สำเร็จ",
                                                    result.message,
                                                    result.ok));
                        }
                    } catch (Exception e) {
                        OpsLogger.warn(
                                app,
                                "printer",
                                "พิมพ์สรุปรอบพลาด",
                                e.getMessage() == null ? "" : e.getMessage());
                    }
                    if (onDone != null) onDone.run();
                });
    }

    /** @deprecated use printShiftReport(context, kind, onDone) */
    public void printShiftReport(Context context, Runnable onDone) {
        printShiftReport(context, "close", onDone);
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
        JSONObject saleBody = saleBodyFromOutbox(payload);
        JSONObject res = MenuRepository.postJson(SALE_URL, saleBody);
        if (!res.optBoolean("ok", false)) {
            throw new IllegalStateException(res.optString("error", "sale_failed"));
        }
        String billNo = res.optString("billNo", "—");
        String saleId = res.optString("saleId", "");
        double change = res.optDouble("change", 0);
        double total = res.optDouble("total", payload.optDouble("localTotal", 0));
        removeFromQueue(app, payload.optString("clientMutationId"));
        updateReceiptBill(app, payload.optString("clientMutationId"), billNo, saleId, change);
        OpsLogger.info(app, "sync", "ซิงก์บิลแล้ว", billNo + " · " + total);
        if (callback != null) callback.onSynced(billNo, change, total);

        // Avoid double paper when we already printed (e.g. offline provisional).
        if (payload.optBoolean("receiptPrinted", false)
                || isReceiptPrinted(app, payload.optString("clientMutationId"))) {
            return;
        }
        JSONObject shopJson = shop != null ? shop : loadShopJson(app);
        boolean print = autoPrint;
        if (shopJson != null && shopJson.has("autoPrintReceipt")) {
            print = print && shopJson.optBoolean("autoPrintReceipt", true);
        }
        if (print) {
            try {
                payload.put("change", change);
            } catch (Exception ignored) {
                /* ignore */
            }
            maybePrintAndKick(
                    app,
                    shopJson,
                    payload,
                    billNo,
                    total,
                    paymentMethod == null ? payload.optString("paymentMethod") : paymentMethod);
            markReceiptPrinted(app, payload.optString("clientMutationId"));
            try {
                payload.put("receiptPrinted", true);
            } catch (Exception ignored) {
                /* ignore */
            }
        }
    }

    private void tryServerVoid(Context app, String mutationId, String saleId, String reason)
            throws Exception {
        JSONObject body = new JSONObject();
        body.put("installId", DeviceIdentity.getOrCreateInstallId(app));
        body.put("clientMutationId", mutationId);
        if (saleId != null && !saleId.isEmpty()) body.put("saleId", saleId);
        body.put("reason", reason);
        try {
            JSONObject res = MenuRepository.postJson(VOID_URL, body);
            if (res.optBoolean("ok", false)) {
                OpsLogger.info(
                        app,
                        "sale",
                        "ทำลายบิลบนเซิร์ฟเวอร์แล้ว",
                        res.optString("billNo", mutationId));
                return;
            }
            String err = res.optString("error", "void_failed");
            // Sale never reached server — local-only void is enough.
            if (err.contains("ไม่พบ") || "not-found".equals(res.optString("code"))) {
                OpsLogger.info(app, "sale", "ทำลายบิล — ไม่มีบนเซิร์ฟเวอร์", mutationId);
                return;
            }
            pushVoidQueue(app, body);
            OpsLogger.warn(app, "sale", "คิวทำลายบิลรอซิงก์", err);
        } catch (Exception e) {
            pushVoidQueue(app, body);
            OpsLogger.warn(
                    app,
                    "sale",
                    "คิวทำลายบิลรอซิงก์",
                    e.getMessage() == null ? "" : e.getMessage());
        }
    }

    private void flushVoidQueue(Context app) {
        try {
            JSONArray q = readVoidQueue(app);
            if (q.length() == 0) return;
            JSONArray remain = new JSONArray();
            for (int i = 0; i < q.length(); i++) {
                JSONObject body = q.getJSONObject(i);
                try {
                    JSONObject res = MenuRepository.postJson(VOID_URL, body);
                    if (res.optBoolean("ok", false)
                            || res.optString("error", "").contains("ไม่พบ")
                            || "not-found".equals(res.optString("code"))) {
                        OpsLogger.info(
                                app,
                                "sale",
                                "ซิงก์ทำลายบิลแล้ว",
                                res.optString("billNo", body.optString("clientMutationId")));
                    } else {
                        remain.put(body);
                    }
                } catch (Exception e) {
                    remain.put(body);
                }
            }
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_VOID_QUEUE, remain.toString())
                    .apply();
        } catch (Exception e) {
            OpsLogger.warn(app, "sale", "flush void queue พลาด", e.getMessage() == null ? "" : e.getMessage());
        }
    }

    private void maybePrintAndKick(
            Context app,
            JSONObject shop,
            JSONObject payload,
            String billNo,
            double total,
            String paymentMethod) {
        PrinterEndpoint ep = PrinterPrefs.savedOrNull(app);
        if (ep == null) {
            OpsLogger.warn(app, "printer", "ข้ามพิมพ์ — ยังไม่เลือกปริ้นเตอร์", billNo);
            return;
        }
        JSONObject shopJson = shop != null ? shop : loadShopJson(app);
        if (payload != null && "cash".equals(paymentMethod) && !payload.has("change")) {
            try {
                double cash = payload.optDouble("cashReceived", 0);
                payload.put("change", Math.max(0, cash - total));
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        String body = ReceiptFormBuilder.build(shopJson, payload, billNo, total);
        byte[] receipt = EscPos.documentReceipt(body);
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

    static JSONObject loadShopJson(Context app) {
        try {
            String raw =
                    app.getSharedPreferences("npos_menu", Context.MODE_PRIVATE)
                            .getString("shopJson", null);
            if (raw != null && !raw.isEmpty()) return new JSONObject(raw);
        } catch (Exception ignored) {
            /* ignore */
        }
        return new JSONObject();
    }

    /** Short local bill label before server assigns billNo (customer paper on offline). */
    static String provisionalBillNo(String mutationId) {
        if (mutationId == null || mutationId.length() < 6) return "LOCAL";
        String tail = mutationId.replace("npos_", "");
        if (tail.length() > 6) tail = tail.substring(tail.length() - 6);
        return "L-" + tail.toUpperCase(java.util.Locale.US);
    }

    /** Flatten option choices for a short kitchen-readable receipt line. */
    static String formatOptionsForReceipt(Object optionsRaw) {
        if (!(optionsRaw instanceof JSONArray)) return "";
        JSONArray groups = (JSONArray) optionsRaw;
        StringBuilder sb = new StringBuilder();
        try {
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.optJSONObject(i);
                if (g == null) continue;
                JSONArray choices = g.optJSONArray("choices");
                if (choices == null) continue;
                for (int j = 0; j < choices.length(); j++) {
                    JSONObject c = choices.optJSONObject(j);
                    if (c == null) continue;
                    String n = c.optString("name", "").trim();
                    if (n.isEmpty()) continue;
                    if (sb.length() > 0) sb.append(" · ");
                    sb.append(n);
                }
            }
        } catch (Exception ignored) {
            return "";
        }
        return sb.toString();
    }

    private static void pushQueue(Context app, JSONObject payload) throws Exception {
        ensureOutboxMeta(payload);
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

    private static JSONArray readVoidQueue(Context app) throws Exception {
        String raw =
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_VOID_QUEUE, "[]");
        return new JSONArray(raw);
    }

    private static void pushVoidQueue(Context app, JSONObject body) throws Exception {
        JSONArray q = readVoidQueue(app);
        String mid = body.optString("clientMutationId");
        for (int i = 0; i < q.length(); i++) {
            if (mid.equals(q.getJSONObject(i).optString("clientMutationId"))) return;
        }
        q.put(body);
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_VOID_QUEUE, q.toString())
                .apply();
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

    private static JSONObject findQueueRow(Context app, String mutationId) throws Exception {
        if (mutationId == null || mutationId.isEmpty()) return null;
        JSONArray q = readQueue(app);
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.getJSONObject(i);
            if (mutationId.equals(o.optString("clientMutationId"))) {
                ensureOutboxMeta(o);
                return o;
            }
        }
        return null;
    }

    private static void writeQueueRow(Context app, JSONObject row) throws Exception {
        String mutationId = row.optString("clientMutationId");
        JSONArray q = readQueue(app);
        JSONArray next = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.getJSONObject(i);
            if (mutationId.equals(o.optString("clientMutationId"))) {
                next.put(row);
                replaced = true;
            } else {
                next.put(o);
            }
        }
        if (!replaced) next.put(row);
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_QUEUE, next.toString())
                .apply();
    }

    private static void markQueueAttempt(
            Context app, String mutationId, String error, boolean permanent) throws Exception {
        JSONObject row = findQueueRow(app, mutationId);
        if (row == null) return;
        int attempts = row.optInt("attempts", 0) + 1;
        row.put("attempts", attempts);
        row.put("lastError", error == null ? "" : error);
        row.put("status", permanent ? "failed" : "pending");
        row.put("lastAttemptAt", System.currentTimeMillis());
        writeQueueRow(app, row);
    }

    static void ensureOutboxMeta(JSONObject payload) throws Exception {
        if (!payload.has("status") || payload.optString("status").isEmpty()) {
            payload.put("status", "pending");
        }
        if (!payload.has("attempts")) payload.put("attempts", 0);
        if (!payload.has("lastError")) payload.put("lastError", "");
        if (!payload.has("createdAt")) payload.put("createdAt", System.currentTimeMillis());
    }

    /** Permanent CF / validation errors — keep in queue as failed, skip auto-flush. */
    static boolean isPermanentSaleError(String message) {
        if (message == null || message.isEmpty()) return false;
        String m = message.toLowerCase(java.util.Locale.US);
        if (m.contains("invalid-argument")) return true;
        if (m.contains("permission-denied")) return true;
        if (m.contains("deviceid")) return true;
        if (message.contains("ตะกร้าว่าง")) return true;
        if (message.contains("ไม่ถูกต้อง")) return true;
        if (message.contains("น้อยกว่ายอดขาย")) return true;
        return false;
    }

    /** Strip outbox meta before POST to nposCompleteSale. */
    static JSONObject saleBodyFromOutbox(JSONObject payload) throws Exception {
        JSONObject body = new JSONObject(payload.toString());
        body.remove("status");
        body.remove("attempts");
        body.remove("lastError");
        body.remove("lastAttemptAt");
        body.remove("localTotal");
        body.remove("subtotal");
        body.remove("receiptPrinted");
        body.remove("receiptFooterNote");
        body.remove("staffName");
        return body;
    }

    private static void rememberReceipt(Context app, JSONObject payload, String billNo) throws Exception {
        JSONArray arr =
                new JSONArray(
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECEIPTS, "[]"));
        JSONObject row = new JSONObject();
        row.put("at", System.currentTimeMillis());
        row.put("mutationId", payload.optString("clientMutationId"));
        row.put("billNo", billNo);
        row.put("saleId", "");
        row.put("total", payload.optDouble("localTotal"));
        row.put("discountBaht", payload.optDouble("discountBaht", 0));
        row.put("subtotal", payload.optDouble("subtotal", 0));
        row.put("cashReceived", payload.optDouble("cashReceived", 0));
        row.put("change", payload.optDouble("change", 0));
        row.put("paymentMethod", payload.optString("paymentMethod"));
        row.put("sessionId", payload.optString("sessionId", ""));
        row.put("staffName", payload.optString("staffName", ""));
        row.put("receiptFooterNote", payload.optString("receiptFooterNote", ""));
        row.put("lines", payload.optJSONArray("lines"));
        row.put("voided", false);
        row.put("printed", false);
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

    private static void markReceiptPrinted(Context app, String mutationId) {
        if (mutationId == null || mutationId.isEmpty()) return;
        try {
            JSONArray arr =
                    new JSONArray(
                            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .getString(KEY_RECEIPTS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (mutationId.equals(o.optString("mutationId"))) {
                    o.put("printed", true);
                    o.put("printedAt", System.currentTimeMillis());
                }
            }
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_RECEIPTS, arr.toString())
                    .apply();
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private static boolean isReceiptPrinted(Context app, String mutationId) {
        if (mutationId == null || mutationId.isEmpty()) return false;
        try {
            JSONArray arr =
                    new JSONArray(
                            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                    .getString(KEY_RECEIPTS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                if (mutationId.equals(o.optString("mutationId"))) {
                    return o.optBoolean("printed", false);
                }
            }
        } catch (Exception ignored) {
            /* ignore */
        }
        return false;
    }

    private static void markReceiptVoided(Context app, String mutationId, String reason) throws Exception {
        JSONArray arr =
                new JSONArray(
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECEIPTS, "[]"));
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            if (mutationId.equals(o.optString("mutationId"))) {
                o.put("voided", true);
                o.put("voidedAt", System.currentTimeMillis());
                o.put("voidReason", reason);
            }
        }
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_RECEIPTS, arr.toString())
                .apply();
    }

    private static void updateReceiptBill(
            Context app, String mutationId, String billNo, String saleId, double change)
            throws Exception {
        JSONArray arr =
                new JSONArray(
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECEIPTS, "[]"));
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            if (mutationId.equals(o.optString("mutationId"))) {
                o.put("billNo", billNo);
                o.put("change", change);
                if (saleId != null && !saleId.isEmpty()) o.put("saleId", saleId);
            }
        }
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_RECEIPTS, arr.toString())
                .apply();
    }
}
