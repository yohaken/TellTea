import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import type { Order, OrderItem, PaymentMethod } from "./types";
import { endOfLocalDay, startOfLocalDay } from "./utils";

export async function createOrder(input: {
  items: OrderItem[];
  paymentMethod: PaymentMethod;
  createdBy: string;
  note?: string;
}): Promise<string> {
  const total = input.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const payload = {
    items: input.items,
    total,
    paymentMethod: input.paymentMethod,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    note: input.note || "",
  };
  const ref = await addDoc(collection(getDb(), "orders"), payload);
  return ref.id;
}

export async function listOrdersForDay(day = new Date()): Promise<Order[]> {
  const from = startOfLocalDay(day);
  const to = endOfLocalDay(day);
  const snap = await getDocs(
    query(
      collection(getDb(), "orders"),
      where("createdAt", ">=", from),
      where("createdAt", "<=", to),
      orderBy("createdAt", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) }));
}
