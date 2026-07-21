"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Printer, Trash2 } from "lucide-react";
import {
  PRINTER_CONNECTION_LABELS,
  PRINTER_KIND_PROFILES,
  PRINTER_ROLE_LABELS,
  browserPrintTest,
  createPrinterFromKind,
  defaultPrinterSetup,
  getPosPrinterSetup,
  savePosPrinterSetup,
  type PosPrinterConfig,
  type PosPrinterSetup,
  type PrinterKind,
} from "@/lib/pos-printer";

const KIND_OPTIONS: PrinterKind[] = ["builtin_80", "desktop_80", "mobile_58"];

export function PosPrinterSetup({ onError }: { onError: (msg: string | null) => void }) {
  const [setup, setSetup] = useState<PosPrinterSetup>(defaultPrinterSetup());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    void getPosPrinterSetup()
      .then(setSetup)
      .catch((err) => onError((err as Error).message))
      .finally(() => setLoading(false));
  }, [onError]);

  function updatePrinter(id: string, patch: Partial<PosPrinterConfig>) {
    setSetup((prev) => ({
      ...prev,
      printers: prev.printers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }

  function removePrinter(id: string) {
    setSetup((prev) => ({
      ...prev,
      printers: prev.printers.filter((p) => p.id !== id),
    }));
  }

  function addPrinter(kind: PrinterKind) {
    const profile = PRINTER_KIND_PROFILES[kind];
    setSetup((prev) => ({
      ...prev,
      printers: [
        ...prev.printers,
        createPrinterFromKind(kind, {
          name: profile.label,
        }),
      ],
    }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await savePosPrinterSetup({
        printers: setup.printers,
        deviceReceiptPrinter: setup.deviceReceiptPrinter,
      });
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onTest(printer: PosPrinterConfig) {
    setTestingId(printer.id);
    onError(null);
    const result = browserPrintTest(printer);
    if (!result.ok) onError(result.error ?? "ทดสอบพิมพ์ไม่สำเร็จ");
    setTestingId(null);
  }

  return (
    <section className="settings-card">
      <h2 className="settings-card-title" style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <Printer size={18} aria-hidden />
        เครื่องพิมพ์ Thermal
      </h2>
      <p className="muted settings-card-lead">
        Built-in 80mm (ใบเสร็จแคชเชียร์) · Desktop 80mm (ครัว/บาร์ LAN/Wi-Fi/USB) · Mobile 58mm (บลูทูธพกพา)
        — ระบบปรับเลย์เอาต์อัตโนมัติตามความกว้างกระดาษ
      </p>

      {loading ? <p className="empty">กำลังโหลด...</p> : null}

      {!loading ? (
        <form className="pos-menu-form pos-printer-form" onSubmit={(e) => void onSave(e)}>
          <div className="pos-printer-kind-row">
            {KIND_OPTIONS.map((kind) => {
              const profile = PRINTER_KIND_PROFILES[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  className="pos-printer-kind-btn"
                  onClick={() => addPrinter(kind)}
                >
                  <strong>{profile.label}</strong>
                  <span className="muted">{profile.paperWidthMm}mm · {profile.cutMode === "auto" ? "ตัดอัตโนมัติ" : "ฉีกมือ"}</span>
                </button>
              );
            })}
          </div>

          {setup.printers.length === 0 ? (
            <p className="empty">ยังไม่มีเครื่องพิมพ์ — กดเพิ่มด้านบน</p>
          ) : null}

          <div className="pos-printer-list">
            {setup.printers.map((printer) => {
              const profile = PRINTER_KIND_PROFILES[printer.kind];
              return (
                <article key={printer.id} className="pos-printer-card">
                  <div className="pos-printer-card-head">
                    <label>
                      <span>ชื่อเครื่อง</span>
                      <input
                        value={printer.name}
                        onChange={(e) => updatePrinter(printer.id, { name: e.target.value })}
                      />
                    </label>
                    <label className="pos-settings-check">
                      <input
                        type="checkbox"
                        checked={printer.enabled}
                        onChange={(e) => updatePrinter(printer.id, { enabled: e.target.checked })}
                      />
                      <span>เปิดใช้งาน</span>
                    </label>
                  </div>

                  <div className="pos-printer-card-grid">
                    <label>
                      <span>ประเภท</span>
                      <select
                        value={printer.kind}
                        onChange={(e) => {
                          const kind = e.target.value as PrinterKind;
                          const p = PRINTER_KIND_PROFILES[kind];
                          updatePrinter(printer.id, {
                            kind,
                            paperWidthMm: p.paperWidthMm,
                            cutMode: p.cutMode,
                            connection: p.defaultConnection,
                          });
                        }}
                      >
                        {KIND_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {PRINTER_KIND_PROFILES[k].label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>บทบาท</span>
                      <select
                        value={printer.role}
                        onChange={(e) =>
                          updatePrinter(printer.id, {
                            role: e.target.value as PosPrinterConfig["role"],
                          })
                        }
                      >
                        {Object.entries(PRINTER_ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>การเชื่อมต่อ</span>
                      <select
                        value={printer.connection}
                        onChange={(e) =>
                          updatePrinter(printer.id, {
                            connection: e.target.value as PosPrinterConfig["connection"],
                          })
                        }
                      >
                        {Object.entries(PRINTER_CONNECTION_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(printer.connection === "lan" || printer.connection === "wifi") && (
                      <label>
                        <span>Host / IP</span>
                        <input
                          value={printer.networkHost ?? ""}
                          onChange={(e) => updatePrinter(printer.id, { networkHost: e.target.value })}
                          placeholder="192.168.1.100"
                        />
                      </label>
                    )}
                  </div>

                  <p className="muted pos-printer-spec">
                    {profile.paperWidthMm}mm · {profile.charsPerLine} ตัวอักษร/บรรทัด ·{" "}
                    {printer.cutMode === "auto" ? "ตัดกระดาษอัตโนมัติ" : "ฉีกมือ"}
                    {profile.speedMmPerSec ? ` · ~${profile.speedMmPerSec} mm/s` : ""}
                  </p>

                  <div className="pos-printer-card-actions">
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={testingId === printer.id}
                      onClick={() => void onTest(printer)}
                    >
                      {testingId === printer.id ? "กำลังทดสอบ..." : "ทดสอบพิมพ์"}
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label="ลบเครื่องพิมพ์"
                      onClick={() => removePrinter(printer.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="muted" style={{ fontSize: "0.85rem", margin: "0.15rem 0 0" }}>
            เปิด/ปิดพิมพ์หลังขายอยู่การ์ด &quot;พิมพ์หลังขาย&quot;
          </p>

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึกเครื่องพิมพ์"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
