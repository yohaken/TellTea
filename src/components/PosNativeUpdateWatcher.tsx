"use client";

import { useEffect, useRef } from "react";
import { getPosNativeShellBuild, isPosNativeShell } from "@/lib/pos-native";
import { subscribePosNativeRelease } from "@/lib/pos-native-release";
import { POS_NATIVE_SHELL_BUILD } from "@/lib/pos-native-version";
import { reportPosDeviceNativeUpdate } from "@/lib/pos-devices";

/**
 * พื้นฐานอัปเดต APK ตั้งแต่ v1:
 * - อ่าน meta/posNativeRelease
 * - รายงานสถานะเข้า posDevices ให้หลังบ้านเห็น
 * - ขั้นติดตั้งไฟล์จริงทำใน native bridge รอบถัดไป (ตอนนี้รายงาน available / idle)
 */
export function PosNativeUpdateWatcher({
  enabled,
  deviceId,
}: {
  enabled: boolean;
  deviceId: string | null;
}) {
  const lastKey = useRef("");

  useEffect(() => {
    if (!enabled || !deviceId || !isPosNativeShell()) return;

    return subscribePosNativeRelease(
      (release) => {
        const shellBuild = getPosNativeShellBuild() || POS_NATIVE_SHELL_BUILD;
        const hasNewer =
          release.latestShellBuild > 0 && release.latestShellBuild > shellBuild && !!release.apkUrl;
        const status = hasNewer ? "available" : "idle";
        const key = `${status}|${release.latestShellBuild}|${shellBuild}`;
        if (key === lastKey.current) return;
        lastKey.current = key;
        void reportPosDeviceNativeUpdate(deviceId, {
          updateStatus: status,
          updateTargetBuild: hasNewer ? release.latestShellBuild : shellBuild,
          updateError: "",
        }).catch(() => {
          /* heartbeat รอบถัดไปจะส่งซ้ำ */
        });
      },
      () => {
        /* ignore — เน็ตหลุดชั่วคราว */
      },
    );
  }, [deviceId, enabled]);

  return null;
}
