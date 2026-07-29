/**
 * ถอดข้อความจาก PDF (browser) — ใช้ pdfjs-dist
 */
"use client";

import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from "pdfjs-dist";

let workerReady = false;

function ensureWorker() {
  if (workerReady) return;
  // CDN worker — static export ไม่ต้อง copy ไฟล์ worker เอง
  GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsVersion}/build/pdf.worker.min.mjs`;
  workerReady = true;
}

export async function extractPdfTextFromBytes(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  ensureWorker();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? String(it.str) : ""))
      .filter(Boolean)
      .join(" ");
    parts.push(line);
  }
  await doc.destroy();
  return parts.join("\n");
}

export async function extractPdfTextFromFile(file: File): Promise<string> {
  return extractPdfTextFromBytes(await file.arrayBuffer());
}

