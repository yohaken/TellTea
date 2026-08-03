"use client";

/**
 * ที่มายอดเดลิเวอรี่ → หน้าพรีวิวแหล่งนำเข้า
 * (ยังไม่ผสานเข้าตารางสรุปเดือน)
 */
import { VatIngestSources } from "@/components/vat-sales/VatIngestSources";

type Props = { actor: string };

export function VatDeliverySources({ actor }: Props) {
  return <VatIngestSources actor={actor} />;
}
