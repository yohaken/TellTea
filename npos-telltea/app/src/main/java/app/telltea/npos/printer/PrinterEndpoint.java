package app.telltea.npos.printer;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Discover candidate printer endpoints (USB · Bluetooth · LAN tcp). */
public final class PrinterEndpoint {
  public enum Kind {
    USB,
    BLUETOOTH,
    NETWORK
  }

  public final Kind kind;
  public final String id;
  public final String label;
  public final String detail;

  public PrinterEndpoint(Kind kind, String id, String label, String detail) {
    this.kind = kind;
    this.id = id;
    this.label = label;
    this.detail = detail == null ? "" : detail;
  }

  public String displayLine() {
    return kind.name() + " · " + label;
  }

  /** id = tcp:host:port */
  public static PrinterEndpoint network(String host, int port) {
    String h = host == null ? "" : host.trim();
    int p = port <= 0 ? 9100 : port;
    String id = "tcp:" + h + ":" + p;
    return new PrinterEndpoint(Kind.NETWORK, id, h + ":" + p, "LAN ESC/POS");
  }

  public static String networkHost(String endpointId) {
    if (endpointId == null || !endpointId.startsWith("tcp:")) return "";
    String rest = endpointId.substring(4);
    int colon = rest.lastIndexOf(':');
    if (colon <= 0) return rest;
    return rest.substring(0, colon);
  }

  public static int networkPort(String endpointId) {
    if (endpointId == null || !endpointId.startsWith("tcp:")) return 9100;
    String rest = endpointId.substring(4);
    int colon = rest.lastIndexOf(':');
    if (colon < 0 || colon >= rest.length() - 1) return 9100;
    try {
      return Integer.parseInt(rest.substring(colon + 1));
    } catch (Exception e) {
      return 9100;
    }
  }

  public static List<PrinterEndpoint> discover(Context context) {
    List<PrinterEndpoint> out = new ArrayList<>();
    discoverUsb(context, out);
    discoverBluetooth(context, out);
    return out;
  }

  private static void discoverUsb(Context context, List<PrinterEndpoint> out) {
    UsbManager usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
    if (usb == null) return;
    HashMap<String, UsbDevice> map = usb.getDeviceList();
    if (map == null) return;
    for (UsbDevice device : map.values()) {
      if (!hasBulkOut(device)) continue;
      String id =
          String.format(
              Locale.US,
              "usb:%04x:%04x:%d",
              device.getVendorId(),
              device.getProductId(),
              device.getDeviceId());
      String label =
          firstNonEmpty(device.getProductName(), device.getDeviceName(), "USB printer");
      String detail =
          String.format(
              Locale.US, "vendor=%04x product=%04x", device.getVendorId(), device.getProductId());
      out.add(new PrinterEndpoint(Kind.USB, id, label, detail));
    }
  }

  private static void discoverBluetooth(Context context, List<PrinterEndpoint> out) {
    if (Build.VERSION.SDK_INT >= 31
        && context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
            != PackageManager.PERMISSION_GRANTED) {
      return;
    }
    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
    if (adapter == null || !adapter.isEnabled()) return;
    try {
      Set<BluetoothDevice> bonded = adapter.getBondedDevices();
      if (bonded == null) return;
      for (BluetoothDevice device : bonded) {
        String name = safeName(device);
        String addr = device.getAddress();
        String id = "bt:" + addr;
        String label = firstNonEmpty(name, addr, "BT printer");
        out.add(new PrinterEndpoint(Kind.BLUETOOTH, id, label, "paired · " + addr));
      }
    } catch (SecurityException ignored) {
      /* permission */
    }
  }

  static UsbDevice findUsbDevice(Context context, String endpointId) {
    if (endpointId == null || !endpointId.startsWith("usb:")) return null;
    String[] parts = endpointId.split(":");
    if (parts.length < 4) return null;
    int vendor;
    int product;
    int deviceId;
    try {
      vendor = Integer.parseInt(parts[1], 16);
      product = Integer.parseInt(parts[2], 16);
      deviceId = Integer.parseInt(parts[3]);
    } catch (Exception e) {
      return null;
    }
    UsbManager usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
    if (usb == null) return null;
    HashMap<String, UsbDevice> map = usb.getDeviceList();
    if (map == null) return null;
    for (UsbDevice device : map.values()) {
      if (device.getVendorId() == vendor
          && device.getProductId() == product
          && device.getDeviceId() == deviceId) {
        return device;
      }
    }
    for (UsbDevice device : map.values()) {
      if (device.getVendorId() == vendor && device.getProductId() == product) {
        return device;
      }
    }
    return null;
  }

  static BluetoothDevice findBluetoothDevice(Context context, String endpointId) {
    if (endpointId == null || !endpointId.startsWith("bt:")) return null;
    String addr = endpointId.substring(3);
    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
    if (adapter == null) return null;
    try {
      return adapter.getRemoteDevice(addr);
    } catch (Exception e) {
      return null;
    }
  }

  static boolean hasBulkOut(UsbDevice device) {
    for (int i = 0; i < device.getInterfaceCount(); i++) {
      UsbInterface iface = device.getInterface(i);
      for (int e = 0; e < iface.getEndpointCount(); e++) {
        UsbEndpoint ep = iface.getEndpoint(e);
        if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
            && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
          return true;
        }
      }
    }
    return false;
  }

  static UsbEndpoint findBulkOut(UsbInterface iface) {
    for (int e = 0; e < iface.getEndpointCount(); e++) {
      UsbEndpoint ep = iface.getEndpoint(e);
      if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
          && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
        return ep;
      }
    }
    return null;
  }

  private static String safeName(BluetoothDevice device) {
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
