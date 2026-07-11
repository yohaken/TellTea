export type StaffRole = "owner" | "staff";

export type StaffMember = {
  email: string;
  role: StaffRole;
  displayName?: string;
  createdAt: number;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  sortOrder: number;
  updatedAt: number;
};

export type OrderItem = {
  menuId: string;
  name: string;
  price: number;
  qty: number;
};

export type PaymentMethod = "cash" | "transfer";

export type Order = {
  id: string;
  items: OrderItem[];
  total: number;
  paymentMethod: PaymentMethod;
  createdBy: string;
  createdAt: number;
  note?: string;
};

export type CartLine = {
  menuId: string;
  name: string;
  price: number;
  qty: number;
};
