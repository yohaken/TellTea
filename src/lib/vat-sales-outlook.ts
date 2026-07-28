/**
 * Client helpers for Outlook / Hotmail VAT mail (owner-only).
 * Parallel to Gmail helpers in vat-sales-mail.ts.
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDb, getFirebaseFunctions } from "./firebase";
import type { VatMailStatus } from "./vat-sales-mail";

export const VAT_OUTLOOK_OAUTH_CONFIG_DOC = "vatMailOAuthConfigOutlook";

export async function fetchVatOutlookStatus(): Promise<VatMailStatus> {
  const fn = httpsCallable<
    Record<string, never>,
    {
      hasConfig: boolean;
      connected: boolean;
      provider: string | null;
      email: string;
      connectedAt: number;
      lastSyncAt: number;
      lastSyncError: string;
      lastSyncAdded: number;
    }
  >(getFirebaseFunctions(), "vatOutlookStatus");
  const res = await fn({});
  return {
    hasConfig: Boolean(res.data.hasConfig),
    connected: Boolean(res.data.connected),
    provider: res.data.provider || null,
    email: String(res.data.email || ""),
    connectedAt: Number(res.data.connectedAt) || 0,
    lastSyncAt: Number(res.data.lastSyncAt) || 0,
    lastSyncError: String(res.data.lastSyncError || ""),
    lastSyncAdded: Number(res.data.lastSyncAdded) || 0,
  };
}

export async function startVatOutlookOAuth(returnTo: string): Promise<string> {
  const fn = httpsCallable<{ returnTo?: string }, { url: string }>(
    getFirebaseFunctions(),
    "vatOutlookOAuthStart",
  );
  const res = await fn({ returnTo });
  return String(res.data.url || "");
}

export async function disconnectVatOutlook(): Promise<void> {
  const fn = httpsCallable(getFirebaseFunctions(), "vatOutlookDisconnect");
  await fn({});
}

export async function syncVatOutlook(lookbackDays = 31): Promise<{
  scanned: number;
  added: number;
  skipped: number;
  lookbackDays: number;
}> {
  const fn = httpsCallable<
    { lookbackDays?: number },
    { scanned: number; added: number; skipped: number; lookbackDays: number }
  >(getFirebaseFunctions(), "vatOutlookSync");
  const res = await fn({ lookbackDays });
  return res.data;
}

export type VatOutlookOAuthConfigPublic = {
  clientId: string;
  redirectUri: string;
  hasSecret: boolean;
  updatedAt: number;
};

export async function loadVatOutlookOAuthConfig(): Promise<VatOutlookOAuthConfigPublic | null> {
  const snap = await getDoc(doc(getDb(), "meta", VAT_OUTLOOK_OAUTH_CONFIG_DOC));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  const clientId = String(data.clientId || "").trim();
  const redirectUri = String(data.redirectUri || "").trim();
  if (!clientId && !redirectUri) return null;
  return {
    clientId,
    redirectUri,
    hasSecret: Boolean(String(data.clientSecret || "").trim()),
    updatedAt: Number(data.updatedAt) || 0,
  };
}

export async function saveVatOutlookOAuthConfig(input: {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  updatedBy: string;
}): Promise<void> {
  const clientId = input.clientId.trim();
  const redirectUri = input.redirectUri.trim();
  if (!clientId || !redirectUri) {
    throw new Error("ต้องมี Client ID และ Redirect URI");
  }
  const payload: Record<string, unknown> = {
    clientId,
    redirectUri,
    updatedAt: Date.now(),
    updatedBy: input.updatedBy,
  };
  const secret = (input.clientSecret || "").trim();
  if (secret) payload.clientSecret = secret;
  await setDoc(doc(getDb(), "meta", VAT_OUTLOOK_OAUTH_CONFIG_DOC), payload, { merge: true });
}
