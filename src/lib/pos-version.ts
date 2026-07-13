/**
 * POS product version — แยกจาก TellTea หลังร้าน (APP_BUILD).
 * Bump POS_BUILD เมื่อ ship การเปลี่ยนแปลง POS เท่านั้น.
 */
import { formatAppBuiltAt, APP_BUILT_AT } from "./version";

export const POS_BUILD = 8;

export function posVersionLabel() {
  return `POS ${POS_BUILD} · ${formatAppBuiltAt(APP_BUILT_AT)}`;
}
