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

export type PosOutboxEntry = {
  id: string;
  kind: "sale";
  createdAt: number;
  attempts: number;
  lastError?: string;
  payload: PosSaleMutationPayload;
};

export type PosSaleResult = {
  saleId: string;
  billNo: string;
  change: number;
  total: number;
  pending?: boolean;
  clientMutationId?: string;
};
