/**
 * Agent Dump API — owner สร้าง token ครั้งเดียว · AI เรียก HTTP อ่านแคตตาล็อกเมล
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export const VAT_AGENT_API_DOC = "vatAgentApi";

export const VAT_MAIL_AGENT_DUMP_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/vatMailAgentDump";

export const VAT_MAIL_AGENT_PROPOSE_URL =
  "https://asia-southeast1-mypeer-501909.cloudfunctions.net/vatMailAgentPropose";

export type VatAgentApi = {
  token: string;
  enabled: boolean;
  updatedAt: number;
  updatedBy: string;
  lastUsedAt: number;
};

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadVatAgentApi(): Promise<VatAgentApi | null> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_AGENT_API_DOC));
  if (!snap.exists()) return null;
  const d = snap.data() || {};
  const token = String(d.token || "").trim();
  if (!token) return null;
  return {
    token,
    enabled: d.enabled !== false,
    updatedAt: Number(d.updatedAt) || 0,
    updatedBy: String(d.updatedBy || ""),
    lastUsedAt: Number(d.lastUsedAt) || 0,
  };
}

export async function rotateVatAgentApiToken(
  actor: string,
): Promise<VatAgentApi> {
  const next: VatAgentApi = {
    token: randomToken(),
    enabled: true,
    updatedAt: Date.now(),
    updatedBy: actor || "owner",
    lastUsedAt: 0,
  };
  await setDoc(doc(getDb(), "meta", VAT_AGENT_API_DOC), next, { merge: true });
  return next;
}

export async function setVatAgentApiEnabled(
  enabled: boolean,
  actor: string,
): Promise<void> {
  await setDoc(
    doc(getDb(), "meta", VAT_AGENT_API_DOC),
    {
      enabled: Boolean(enabled),
      updatedAt: Date.now(),
      updatedBy: actor || "owner",
    },
    { merge: true },
  );
}

export function agentDumpCurl(token: string): string {
  const t = String(token || "").trim();
  return `curl -sS -H "Authorization: Bearer ${t}" "${VAT_MAIL_AGENT_DUMP_URL}?max=80"`;
}

export function agentProposeCurl(token: string, monthKey = "2026-07"): string {
  const t = String(token || "").trim();
  const body = JSON.stringify({
    monthKey,
    channels: {
      grab: {
        note: "F4 daily adapter example",
        days: [
          {
            dateKey: `${monthKey}-01`,
            appSales: 1000,
            transfer: 800,
          },
        ],
      },
    },
  });
  return `curl -sS -X POST -H "Authorization: Bearer ${t}" -H "Content-Type: application/json" -d '${body}' "${VAT_MAIL_AGENT_PROPOSE_URL}"`;
}
