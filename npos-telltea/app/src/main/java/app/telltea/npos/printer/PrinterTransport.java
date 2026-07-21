package app.telltea.npos.printer;

import android.app.PendingIntent;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Sends raw ESC/POS bytes to USB bulk-out or Bluetooth SPP. */
public final class PrinterTransport {
    public static final String ACTION_USB_PERMISSION = "app.telltea.npos.USB_PERMISSION";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    public static final class Result {
        public final boolean ok;
        public final String message;

        public Result(boolean ok, String message) {
            this.ok = ok;
            this.message = message == null ? "" : message;
        }
    }

    public interface Callback {
        void onDone(Result result);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public void send(Context context, PrinterEndpoint endpoint, byte[] payload, Callback callback) {
        Context app = context.getApplicationContext();
        executor.execute(
                () -> {
                    Result result;
                    try {
                        if (endpoint.kind == PrinterEndpoint.Kind.USB) {
                            result = sendUsb(app, endpoint, payload);
                        } else if (endpoint.kind == PrinterEndpoint.Kind.NETWORK) {
                            result = sendTcp(endpoint, payload);
                        } else {
                            result = sendBluetooth(app, endpoint, payload);
                        }
                    } catch (Exception e) {
                        String msg =
                                e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                        result = new Result(false, msg);
                    }
                    if (callback != null) callback.onDone(result);
                });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    private static Result sendUsb(Context context, PrinterEndpoint endpoint, byte[] payload)
            throws Exception {
        UsbManager usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usb == null) return new Result(false, "no UsbManager");
        UsbDevice device = PrinterEndpoint.findUsbDevice(context, endpoint.id);
        if (device == null) return new Result(false, "USB device not found — เสียบใหม่แล้วสแกน");

        if (!usb.hasPermission(device)) {
            boolean granted = requestUsbPermission(context, usb, device);
            if (!granted) return new Result(false, "ยังไม่อนุญาต USB — กด Allow แล้วลองใหม่");
        }

        UsbInterface iface = null;
        UsbEndpoint bulkOut = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            UsbEndpoint ep = PrinterEndpoint.findBulkOut(candidate);
            if (ep != null) {
                iface = candidate;
                bulkOut = ep;
                break;
            }
        }
        if (iface == null || bulkOut == null) {
            return new Result(false, "USB ไม่มี bulk OUT (อาจไม่ใช่ปริ้นเตอร์)");
        }

        UsbDeviceConnection connection = usb.openDevice(device);
        if (connection == null) return new Result(false, "เปิด USB ไม่ได้");
        try {
            if (!connection.claimInterface(iface, true)) {
                return new Result(false, "claimInterface ล้มเหลว");
            }
            int offset = 0;
            while (offset < payload.length) {
                int chunk = Math.min(bulkOut.getMaxPacketSize(), payload.length - offset);
                int written =
                        connection.bulkTransfer(bulkOut, payload, offset, chunk, 5_000);
                if (written < 0) {
                    return new Result(false, "bulkTransfer failed (" + written + ")");
                }
                offset += written;
            }
            return new Result(true, "USB ส่งแล้ว " + payload.length + " bytes");
        } finally {
            try {
                connection.releaseInterface(iface);
            } catch (Exception ignored) {
                /* ignore */
            }
            connection.close();
        }
    }

    private static boolean requestUsbPermission(Context context, UsbManager usb, UsbDevice device)
            throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Boolean> granted = new AtomicReference<>(false);
        BroadcastReceiver receiver =
                new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context ctx, Intent intent) {
                        if (!ACTION_USB_PERMISSION.equals(intent.getAction())) return;
                        boolean ok = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                        granted.set(ok);
                        latch.countDown();
                        try {
                            ctx.unregisterReceiver(this);
                        } catch (Exception ignored) {
                            /* ignore */
                        }
                    }
                };
        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(receiver, filter);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi =
                PendingIntent.getBroadcast(context, 0, new Intent(ACTION_USB_PERMISSION), flags);
        usb.requestPermission(device, pi);
        boolean finished = latch.await(25, TimeUnit.SECONDS);
        if (!finished) {
            try {
                context.unregisterReceiver(receiver);
            } catch (Exception ignored) {
                /* ignore */
            }
            return false;
        }
        return Boolean.TRUE.equals(granted.get());
    }

    private static Result sendTcp(PrinterEndpoint endpoint, byte[] payload) throws Exception {
        String host = PrinterEndpoint.networkHost(endpoint.id);
        int port = PrinterEndpoint.networkPort(endpoint.id);
        if (host.isEmpty()) return new Result(false, "ไม่มี IP ปริ้นเตอร์ LAN");
        java.net.Socket socket = new java.net.Socket();
        try {
            socket.connect(new java.net.InetSocketAddress(host, port), 5_000);
            socket.setSoTimeout(8_000);
            OutputStream out = socket.getOutputStream();
            out.write(payload);
            out.flush();
            return new Result(true, "LAN ส่งแล้ว " + payload.length + " bytes → " + host + ":" + port);
        } finally {
            try {
                socket.close();
            } catch (Exception ignored) {
                /* ignore */
            }
        }
    }

    private static Result sendBluetooth(Context context, PrinterEndpoint endpoint, byte[] payload)
            throws Exception {
        BluetoothDevice device = PrinterEndpoint.findBluetoothDevice(context, endpoint.id);
        if (device == null) return new Result(false, "BT device not found — จับคู่ใหม่");

        BluetoothSocket socket = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            socket.connect();
            OutputStream out = socket.getOutputStream();
            out.write(payload);
            out.flush();
            return new Result(true, "BT ส่งแล้ว " + payload.length + " bytes");
        } catch (SecurityException se) {
            return new Result(false, "ต้องการสิทธิ์ Bluetooth");
        } finally {
            if (socket != null) {
                try {
                    socket.close();
                } catch (Exception ignored) {
                    /* ignore */
                }
            }
        }
    }
}
