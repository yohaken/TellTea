import { buildKitchenTicketHtml, buildReceiptHtml, buildTestPageHtml } from "../layout";
import { getLayoutForPrinter } from "../profiles";
import type { PosPrinterConfig, PrintJob, PrintResult } from "../types";

/** Phase 1 driver — เปิดหน้าต่างพิมพ์เบราว์เซอร์ ปรับความกว้างตามโปรไฟล์เครื่องพิมพ์ */
export function canBrowserPrint(): boolean {
  return typeof window !== "undefined" && typeof window.print === "function";
}

function openPrintWindow(html: string, printer: PosPrinterConfig): boolean {
  if (!canBrowserPrint()) return false;
  const layout = getLayoutForPrinter(printer);
  const height = layout.paperWidthMm === 58 ? 520 : 640;
  const win = window.open("", "_blank", `width=${layout.popupWidthPx},height=${height}`);
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

export function browserPrintJob(job: PrintJob): PrintResult {
  const { printer, payload, id } = job;
  if (!printer.enabled) {
    return { jobId: id, printerId: printer.id, printerName: printer.name, ok: false, error: "ปิดใช้งาน" };
  }

  let html: string;
  if (payload.kind === "receipt") {
    html = buildReceiptHtml(payload, printer);
  } else {
    html = buildKitchenTicketHtml(payload, printer);
  }

  const ok = openPrintWindow(html, printer);
  return {
    jobId: id,
    printerId: printer.id,
    printerName: printer.name,
    ok,
    error: ok ? undefined : "เปิดหน้าต่างพิมพ์ไม่ได้ — อนุญาต popup",
  };
}

export function browserPrintTest(printer: PosPrinterConfig): PrintResult {
  const ok = openPrintWindow(buildTestPageHtml(printer), printer);
  return {
    jobId: `test_${printer.id}`,
    printerId: printer.id,
    printerName: printer.name,
    ok,
    error: ok ? undefined : "เปิดหน้าต่างพิมพ์ไม่ได้",
  };
}

/** เลือก driver ตาม connection — เฟส 1 ใช้ browser สำหรับทุกช่องทาง */
export function dispatchJob(job: PrintJob): PrintResult {
  const { connection } = job.printer;
  switch (connection) {
    case "builtin":
    case "browser":
    case "lan":
    case "wifi":
    case "usb":
    case "bluetooth":
      return browserPrintJob(job);
    default:
      return browserPrintJob(job);
  }
}
