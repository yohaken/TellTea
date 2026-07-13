import { dispatchJob } from "./drivers/browser-print";
import { canBrowserPrint } from "./drivers/browser-print";
import { getCachedPrinterSetup } from "./storage";
import type {
  KitchenTicketPrintPayload,
  PosPrinterConfig,
  PosPrinterSetup,
  PrintBatchResult,
  PrintJob,
  PrintPayload,
  ReceiptPrintPayload,
} from "./types";

let jobCounter = 0;

function nextJobId(): string {
  jobCounter += 1;
  return `job_${Date.now()}_${jobCounter}`;
}

function enabledPrinters(setup: PosPrinterSetup): PosPrinterConfig[] {
  return setup.printers.filter((p) => p.enabled);
}

function receiptPrinterForDevice(setup: PosPrinterSetup, deviceId?: string): PosPrinterConfig | null {
  const enabled = enabledPrinters(setup);
  if (deviceId && setup.deviceReceiptPrinter[deviceId]) {
    const mapped = enabled.find((p) => p.id === setup.deviceReceiptPrinter[deviceId]);
    if (mapped) return mapped;
  }
  return (
    enabled.find((p) => p.role === "receipt") ??
    enabled.find((p) => p.kind === "builtin_80") ??
    enabled[0] ??
    null
  );
}

function stationPrinters(setup: PosPrinterSetup, role: "kitchen" | "bar"): PosPrinterConfig[] {
  return enabledPrinters(setup).filter((p) => p.role === role);
}

function makeJob(printer: PosPrinterConfig, payload: PrintPayload): PrintJob {
  return { id: nextJobId(), printer, payload };
}

export function buildReceiptJobs(
  payload: ReceiptPrintPayload,
  setup: PosPrinterSetup,
  deviceId?: string,
): PrintJob[] {
  const printer = receiptPrinterForDevice(setup, deviceId);
  if (!printer) return [];
  return [makeJob(printer, payload)];
}

export function buildKitchenJobs(
  payload: Omit<KitchenTicketPrintPayload, "kind">,
  setup: PosPrinterSetup,
): PrintJob[] {
  const jobs: PrintJob[] = [];
  if (setup.autoPrintKitchen) {
    for (const printer of stationPrinters(setup, "kitchen")) {
      jobs.push(
        makeJob(printer, {
          ...payload,
          kind: "kitchen_ticket",
          stationLabel: printer.name,
        }),
      );
    }
  }
  if (setup.autoPrintBar) {
    for (const printer of stationPrinters(setup, "bar")) {
      jobs.push(
        makeJob(printer, {
          ...payload,
          kind: "bar_ticket",
          stationLabel: printer.name,
        }),
      );
    }
  }
  return jobs;
}

export function buildSalePrintJobs(
  receipt: ReceiptPrintPayload,
  setup: PosPrinterSetup,
  deviceId?: string,
): PrintJob[] {
  return [
    ...buildReceiptJobs(receipt, setup, deviceId),
    ...buildKitchenJobs(
      {
        billNo: receipt.billNo,
        lines: receipt.lines,
        createdAt: receipt.createdAt,
      },
      setup,
    ),
  ];
}

/** ส่งงานพิมพ์ตามลำดับ — หน่วงเล็กน้อยระหว่างเครื่องเพื่อไม่ให้ popup ถูกบล็อก */
export async function runPrintJobs(jobs: PrintJob[]): Promise<PrintBatchResult> {
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    if (i > 0) await delay(400);
    results.push(dispatchJob(jobs[i]));
  }
  const printed = results.filter((r) => r.ok).length;
  return { results, printed, failed: results.length - printed };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function printSaleDocuments(
  receipt: ReceiptPrintPayload,
  options?: { deviceId?: string; setup?: PosPrinterSetup; receiptOnly?: boolean },
): Promise<PrintBatchResult> {
  const setup = options?.setup ?? getCachedPrinterSetup();
  const deviceId = options?.deviceId;
  const jobs = options?.receiptOnly
    ? buildReceiptJobs(receipt, setup, deviceId)
    : buildSalePrintJobs(receipt, setup, deviceId);
  return runPrintJobs(jobs);
}

/** หลังขายสำเร็จ — ควบคุมแยกว่าจะพิมพ์ใบเสร็จหรือไม่ ครัว/บาร์ตามตั้งค่าใน printer setup */
export async function printOnSaleComplete(
  receipt: ReceiptPrintPayload,
  options: { deviceId?: string; printReceipt: boolean; setup?: PosPrinterSetup },
): Promise<PrintBatchResult> {
  const setup = options.setup ?? getCachedPrinterSetup();
  const jobs: PrintJob[] = [];
  if (options.printReceipt) {
    jobs.push(...buildReceiptJobs(receipt, setup, options.deviceId));
  }
  jobs.push(
    ...buildKitchenJobs(
      { billNo: receipt.billNo, lines: receipt.lines, createdAt: receipt.createdAt },
      setup,
    ),
  );
  return runPrintJobs(jobs);
}

export type PrinterReadiness = {
  browserPrint: boolean;
  enabledCount: number;
  receiptReady: boolean;
  kitchenCount: number;
  barCount: number;
  label: string;
};

export function getPrinterReadiness(setup?: PosPrinterSetup): PrinterReadiness {
  const s = setup ?? getCachedPrinterSetup();
  const enabled = enabledPrinters(s);
  const browserPrint = canBrowserPrint();
  const receiptReady = browserPrint && receiptPrinterForDevice(s) != null;
  const kitchenCount = stationPrinters(s, "kitchen").length;
  const barCount = stationPrinters(s, "bar").length;

  let label = "ไม่มีพิมพ์";
  if (!browserPrint) label = "ไม่มีพิมพ์";
  else if (enabled.length === 0) label = "ยังไม่ตั้งเครื่องพิมพ์";
  else if (receiptReady) label = `พิมพ์ได้ · ${enabled.length} เครื่อง`;
  else label = "พิมพ์ไม่พร้อม";

  return {
    browserPrint,
    enabledCount: enabled.length,
    receiptReady,
    kitchenCount,
    barCount,
    label,
  };
}
