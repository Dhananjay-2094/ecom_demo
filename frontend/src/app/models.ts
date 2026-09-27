// Product fields shared by the public catalog and admin product screens.
export interface Product {
  id: string;
  name: string;
  unitPriceMinor: number;
  inventory: number;
  active: boolean | number;
}

// Current cart line, including live stock and price from the catalog.
export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  availableInventory: number;
}

// Cart response returned by the backend.
export interface Cart {
  id: string;
  status: 'open' | 'checked_out';
  items: CartItem[];
  subtotalMinor: number;
  orderId: string | null;
}

// Saved order result returned after checkout.
export interface Order {
  id: string;
  couponCode: string | null;
  items: CartItem[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
}

// Coupon fields used to display its milestone and lifecycle status.
export interface Coupon {
  code: string;
  milestoneOrderCount: number;
  discountPercent: number;
  status: 'available' | 'redeemed' | 'cancelled';
  redeemedOrderId: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
  cancelledAt?: string;
}

// Read-only summary returned by the admin report endpoint.
export interface Report {
  totalOrders: number;
  quantityByProduct: { productId: string; productName: string; quantity: number }[];
  grossRevenueMinor: number;
  totalDiscountsMinor: number;
  netRevenueMinor: number;
  coupons: { generated: number; available: number; redeemed: number; cancelled?: number };
}
