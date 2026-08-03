/**
 * POS product version — แยกจาก TellTea หลังร้าน (APP_BUILD).
 * Bump POS_BUILD เมื่อ ship การเปลี่ยนแปลง POS เท่านั้น.
 */
import { formatAppBuiltAt, APP_BUILT_AT } from "./version";

<<<<<<< HEAD
export const POS_BUILD = 176;
=======
export const POS_BUILD = 175;
>>>>>>> c76b29b7 (fix(npos): X-report item amounts and cash/BO parity)

export function posVersionLabel() {
  return `POS ${POS_BUILD} · ${formatAppBuiltAt(APP_BUILT_AT)}`;
}
