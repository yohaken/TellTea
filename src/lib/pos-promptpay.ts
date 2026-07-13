import QRCode from "qrcode";

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

/** EMV QR payload for Thailand PromptPay (phone 10 digits or tax ID 13 digits). */
export function buildPromptPayPayload(promptPayId: string, amount: number): string {
  const digits = promptPayId.replace(/\D/g, "");
  let merchantInfo: string;

  if (digits.length === 10 && digits.startsWith("0")) {
    merchantInfo = tlv("01", tlv("01", `0066${digits.slice(1)}`));
  } else if (digits.length === 13) {
    merchantInfo = tlv("02", tlv("01", digits));
  } else {
    throw new Error("เลข PromptPay ไม่ถูกต้อง — ใช้เบอร์ 10 หลักหรือเลขผู้เสียภาษี 13 หลัก");
  }

  let payload =
    tlv("00", "01") +
    tlv("01", amount > 0 ? "12" : "11") +
    tlv("29", merchantInfo) +
    tlv("53", "764") +
    tlv("58", "TH");

  if (amount > 0) {
    payload += tlv("54", amount.toFixed(2));
  }

  payload += "6304";
  return payload + crc16(payload);
}

export async function promptPayQrDataUrl(promptPayId: string, amount: number): Promise<string> {
  const payload = buildPromptPayPayload(promptPayId, amount);
  return QRCode.toDataURL(payload, {
    margin: 1,
    width: 280,
    errorCorrectionLevel: "M",
  });
}

export function maskPromptPayId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-xxx-${digits.slice(-4)}`;
  }
  if (digits.length === 13) {
    return `${digits.slice(0, 4)}-xxx-${digits.slice(-3)}`;
  }
  return id;
}
