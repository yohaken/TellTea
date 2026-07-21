package app.telltea.npos.diagnose;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Best-effort scan of USB / Bluetooth / network endpoints.
 * Discovery only — does not claim print/cash-drawer control yet.
 */
public final class HardwareProbe {
    public static final class Item {
        public final String category;
        public final String title;
        public final String detail;

        public Item(String category, String title, String detail) {
            this.category = category;
            this.title = title;
            this.detail = detail;
        }
    }

    public static final class Result {
        public final List<Item> items;
        public final boolean bluetoothPermissionNeeded;

        public Result(List<Item> items, boolean bluetoothPermissionNeeded) {
            this.items = items;
            this.bluetoothPermissionNeeded = bluetoothPermissionNeeded;
        }
    }

    private HardwareProbe() {}

    public static Result scan(Context context) {
        List<Item> items = new ArrayList<>();
        boolean btNeedPermission = false;

        scanUsb(context, items);
        btNeedPermission = scanBluetooth(context, items);
        scanNetwork(context, items);

        return new Result(items, btNeedPermission);
    }

    private static void scanUsb(Context context, List<Item> items) {
        UsbManager usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        if (usb == null) {
            items.add(new Item("USB", "ไม่รองรับ", "เครื่องนี้ไม่มี UsbManager"));
            return;
        }
        HashMap<String, UsbDevice> map = usb.getDeviceList();
        if (map == null || map.isEmpty()) {
            items.add(new Item("USB", "ไม่พบอุปกรณ์", "ยังไม่มี USB ที่ต่ออยู่ตอนนี้"));
            return;
        }
        for (UsbDevice device : map.values()) {
            String title =
                    firstNonEmpty(
                            device.getProductName(),
                            device.getDeviceName(),
                            "USB device");
            String detail =
                    String.format(
                            Locale.US,
                            "vendor=%04x product=%04x class=%d · อาจเป็นปริ้นเตอร์/ลิ้นชัก/อื่นๆ",
                            device.getVendorId(),
                            device.getProductId(),
                            device.getDeviceClass());
            items.add(new Item("USB", title, detail));
        }
    }

    private static boolean scanBluetooth(Context context, List<Item> items) {
        if (Build.VERSION.SDK_INT >= 31
                && context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                        != PackageManager.PERMISSION_GRANTED) {
            items.add(new Item("Bluetooth", "ยังไม่อนุญาต", "กดสแกนใหม่หลังอนุญาตสิทธิ์"));
            return true;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            items.add(new Item("Bluetooth", "ไม่รองรับ", "เครื่องนี้ไม่มี Bluetooth"));
            return false;
        }
        if (!adapter.isEnabled()) {
            items.add(new Item("Bluetooth", "ปิดอยู่", "เปิด Bluetooth แล้วสแกนใหม่"));
            return false;
        }

        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded == null || bonded.isEmpty()) {
                items.add(new Item("Bluetooth", "ยังไม่จับคู่", "ยังไม่มีเครื่องที่ paired ไว้"));
                return false;
            }
            for (BluetoothDevice device : bonded) {
                String title = firstNonEmpty(safeBtName(device), device.getAddress(), "BT device");
                String detail =
                        "paired · "
                                + device.getAddress()
                                + " · อาจเป็นปริ้นเตอร์มือถือ/ลิ้นชักไร้สาย";
                items.add(new Item("Bluetooth", title, detail));
            }
        } catch (SecurityException se) {
            items.add(new Item("Bluetooth", "ยังไม่อนุญาต", se.getMessage() == null ? "" : se.getMessage()));
            return true;
        }
        return false;
    }

    private static void scanNetwork(Context context, List<Item> items) {
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            try {
                WifiInfo info = wifi.getConnectionInfo();
                if (info != null) {
                    String ssid = info.getSSID();
                    if (ssid != null && !"<unknown ssid>".equals(ssid)) {
                        items.add(
                                new Item(
                                        "Wi‑Fi",
                                        ssid.replace("\"", ""),
                                        "rssi=" + info.getRssi() + " · ใช้ต่อปริ้นเตอร์ LAN/Wi‑Fi ได้"));
                    }
                }
            } catch (Exception ignored) {
                /* ignore */
            }
        }

        ConnectivityManager cm =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null && Build.VERSION.SDK_INT >= 23) {
            Network active = cm.getActiveNetwork();
            if (active != null) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                if (caps != null) {
                    List<String> kinds = new ArrayList<>();
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) kinds.add("Wi‑Fi");
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) kinds.add("มือถือ");
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) kinds.add("Ethernet");
                    if (!kinds.isEmpty()) {
                        items.add(new Item("เครือข่าย", "เชื่อมอยู่", String.join(" + ", kinds)));
                    }
                }
            }
        }

        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            if (ifaces != null) {
                for (NetworkInterface nif : Collections.list(ifaces)) {
                    if (!nif.isUp() || nif.isLoopback()) continue;
                    for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                        if (addr.isLoopbackAddress() || addr.getHostAddress() == null) continue;
                        String host = addr.getHostAddress();
                        if (host.contains(":")) continue; // skip raw IPv6 noise for now
                        items.add(
                                new Item(
                                        "IP",
                                        nif.getName(),
                                        host + " · ใช้ไล่หาปริ้นเตอร์ในร้านได้ภายหลัง"));
                    }
                }
            }
        } catch (Exception ignored) {
            /* ignore */
        }
    }

    private static String safeBtName(BluetoothDevice device) {
        try {
            return device.getName();
        } catch (SecurityException se) {
            return null;
        }
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) return "";
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        return "";
    }
}
