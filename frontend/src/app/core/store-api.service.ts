import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Cart, Coupon, Order, Product, Report } from '../models';

@Injectable({ providedIn: 'root' })
// Keep HTTP endpoint paths and request shapes in one place for the UI.
export class StoreApi {
  private readonly http = inject(HttpClient);

  // Get active products for the customer storefront.
  products() { return firstValueFrom(this.http.get<{ products: Product[] }>('https://ecom-demo-899n.onrender.com/api/products')); }
  // Get active and retired products for admin catalog management.
  adminProducts() { return firstValueFrom(this.http.get<{ products: Product[] }>('https://ecom-demo-899n.onrender.com/api/admin/products')); }
  // Create a new empty shopping cart.
  createCart() { return firstValueFrom(this.http.post<Cart>('https://ecom-demo-899n.onrender.com/api/carts', {})); }
  // Read the latest cart and its calculated subtotal.
  cart(id: string) { return firstValueFrom(this.http.get<Cart>(`https://ecom-demo-899n.onrender.com/api/carts/${id}`)); }
  // Add a product quantity to a cart.
  addItem(cartId: string, productId: string, quantity: number) {
    return firstValueFrom(this.http.post<Cart>(`https://ecom-demo-899n.onrender.com/api/carts/${cartId}/items`, { productId, quantity }));
  }
  // Set the cart line to an exact quantity.
  updateItem(cartId: string, productId: string, quantity: number) {
    return firstValueFrom(this.http.patch<Cart>(`https://ecom-demo-899n.onrender.com/api/carts/${cartId}/items/${productId}`, { quantity }));
  }
  // Remove one product line from a cart.
  removeItem(cartId: string, productId: string) {
    return firstValueFrom(this.http.delete<Cart>(`https://ecom-demo-899n.onrender.com/api/carts/${cartId}/items/${productId}`));
  }
  // Place an order with the idempotency key and optional coupon.
  checkout(cartId: string, key: string, couponCode: string) {
    return firstValueFrom(this.http.post<Order>(`https://ecom-demo-899n.onrender.com/api/carts/${cartId}/checkout`, couponCode ? { couponCode } : {}, {
      headers: { 'Idempotency-Key': key }
    }));
  }
  // Create a catalog product as an admin.
  createProduct(input: { name: string; unitPriceMinor: number; inventory: number }) {
    return firstValueFrom(this.http.post<Product>('https://ecom-demo-899n.onrender.com/api/admin/products', input));
  }
  // Update a catalog product's name and price.
  updateProduct(id: string, input: { name: string; unitPriceMinor: number }) {
    return firstValueFrom(this.http.patch<Product>(`https://ecom-demo-899n.onrender.com/api/admin/products/${id}`, input));
  }
  // Retire a product while preserving its order history.
  retireProduct(id: string) { return firstValueFrom(this.http.delete(`https://ecom-demo-899n.onrender.com/api/admin/products/${id}`)); }
  // Add or remove stock using a signed quantity and a reason.
  adjustInventory(id: string, change: number, reason: string) {
    return firstValueFrom(this.http.post(`https://ecom-demo-899n.onrender.com/api/admin/products/${id}/inventory-adjustments`, { change, reason }));
  }
  // Get coupon history and current statuses.
  coupons() { return firstValueFrom(this.http.get<{ coupons: Coupon[] }>('https://ecom-demo-899n.onrender.com/api/admin/coupons')); }
  // Generate a coupon if the latest reward milestone is eligible.
  generateCoupon() { return firstValueFrom(this.http.post<Coupon>('https://ecom-demo-899n.onrender.com/api/admin/coupons/generate', {})); }
  // Cancel an available coupon without deleting its audit history.
  cancelCoupon(code: string) { return firstValueFrom(this.http.delete(`https://ecom-demo-899n.onrender.com/api/admin/coupons/${encodeURIComponent(code)}`)); }
  // Get the read-only order, revenue, and coupon report.
  report() { return firstValueFrom(this.http.get<Report>('https://ecom-demo-899n.onrender.com/api/admin/report')); }
}
