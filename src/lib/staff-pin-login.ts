import { httpsCallable } from "firebase/functions";
import { signInWithCustomToken } from "firebase/auth";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase";

export type StaffPinLoginResult = {
  ok: boolean;
  token: string;
  staffId: string;
  displayName?: string;
};

export type SetStaffLoginPinResult = {
  ok: boolean;
  staffId: string;
  cleared?: boolean;
  loginPinSetAt?: number;
  loginNames?: string[];
};

/** เข้าใช้ด้วยชื่อเล่น/ชื่อในร้าน + PIN (ไม่ผ่าน Google) */
export async function signInWithStaffPin(
  nickname: string,
  pin: string,
): Promise<StaffPinLoginResult> {
  const fn = httpsCallable<
    { nickname: string; pin: string },
    StaffPinLoginResult
  >(getFirebaseFunctions(), "staffPinLogin");
  const res = await fn({ nickname: nickname.trim(), pin: pin.trim() });
  const data = res.data;
  if (!data?.ok || !data.token) {
    throw new Error("เข้าใช้ด้วย PIN ไม่สำเร็จ");
  }
  await signInWithCustomToken(getFirebaseAuth(), data.token);
  return data;
}

/** เจ้าของตั้ง/ล้าง PIN ของพนักงาน */
export async function setStaffLoginPin(input: {
  staffId: string;
  pin?: string;
  clear?: boolean;
  nicknameHint?: string;
}): Promise<SetStaffLoginPinResult> {
  const fn = httpsCallable<
    {
      staffId: string;
      pin?: string;
      clear?: boolean;
      nicknameHint?: string;
    },
    SetStaffLoginPinResult
  >(getFirebaseFunctions(), "setStaffLoginPin");
  const res = await fn({
    staffId: input.staffId,
    pin: input.pin,
    clear: input.clear === true,
    nicknameHint: input.nicknameHint,
  });
  return res.data;
}
