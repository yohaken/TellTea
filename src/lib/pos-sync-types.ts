import type { PosSaleLine, PosSalePaymentMethod } from "./types";

export type PosSaleMutationPayload = {
  clientMutationId: string;
  deviceId: string;
  sessionId: string;
  shift: string;
  lines: PosSaleLine[];
  paymentMethod: PosSalePaymentMethod;
  cashReceived: number;
};

export type PosOutboxStatus = "pending" | "failed";

export type PosOutboxEntry = {
  id: string;
  kind: "sale";
  createdAt: number;
  attempts: number;
  status?: PosOutboxStatus;
  lastError?: string;
  payload: PosSaleMutationPayload;
};

export type PosOutboxBillView = {
  id: string;
  billNo: string;
  sessionId: string;
  total: number;
  paymentMethod: PosSalePaymentMethod;
  shift: string;
  linePreview: string;
  createdAt: number;
  attempts: number;
  status: PosOutboxStatus;
  lastError?: string;
  stuck: boolean;
};

export type PosSaleResult = {
  saleId: string;
  billNo: string;
  change: number;
  total: number;
  pending?: boolean;
  clientMutationId?: string;
};
