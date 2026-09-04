import type { DeliveryChannel, LiveChannelSnapshot } from "@/lib/menu-channel-price";
import raw from "./live-scans.json";

type RawBundle = Record<
  DeliveryChannel,
  {
    scannedAt: string | null;
    count: number;
    items: { id: string; name: string; listPrice: number | null }[];
  }
>;

const bundle = raw as RawBundle;

export const CHANNEL_LIVE_SCANS: Record<DeliveryChannel, LiveChannelSnapshot> = {
  shopee: bundle.shopee,
  grab: bundle.grab,
  lineman: bundle.lineman,
};

export function getChannelLiveScan(channel: DeliveryChannel): LiveChannelSnapshot {
  return CHANNEL_LIVE_SCANS[channel];
}
