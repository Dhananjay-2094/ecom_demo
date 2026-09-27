import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Cart, Coupon, Order, Product, Report } from './models';
import { StoreApi } from './core/store-api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly api = inject(StoreApi);
  private readonly changeDetector = inject(ChangeDetectorRef);
  view: 'shop' | 'admin' = 'shop';
  products: Product[] = [];
  adminProducts: Product[] = [];
  cart: Cart | null = null;
  order: Order | null = null;
  coupons: Coupon[] = [];
  report: Report | null = null;
  couponCode = '';
  checkoutKey = '';
  message = '';
  busy = false;
  loading = true;
  quantities: Record<string, number> = {};
  productDraft: { name: string; unitPriceMinor: number; inventory: number } = {
    name: '', unitPriceMinor: 0, inventory: 0
  };
  drafts: Record<string, { name: string; unitPriceMinor: number }> = {};
  inventoryChanges: Record<string, number> = {};
  inventoryReason = 'Stock adjustment';

  // Load the storefront and restore or create the customer's cart when the app opens.
  async ngOnInit() {
    try {
      await Promise.all([this.loadProducts(), this.ensureCart()]);
    } catch (error) {
      // Show API/network failures in the shared status message.
      this.showError(error);
    } finally {
      // Finish the initial loading state and schedule a screen refresh.
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  // Fetch active products and initialize their quantity controls.
  async loadProducts() {
    this.products = (await this.api.products()).products;
    for (const product of this.products) this.quantities[product.id] ??= 1;
  }

  // Reuse an open cart from this browser, or create a new one if needed.
  async ensureCart() {
    // Look for the cart ID saved by the previous visit.
    const savedId = localStorage.getItem('active-cart-id');
    if (savedId) {
      try {
        // Reuse the saved cart only while it is still open.
        this.cart = await this.api.cart(savedId);
        if (this.cart.status === 'open') return;
      } catch {
        // Forget a cart ID that no longer exists in the backend.
        localStorage.removeItem('active-cart-id');
      }
    }
    // Create and remember a replacement cart.
    this.cart = await this.api.createCart();
    localStorage.setItem('active-cart-id', this.cart.id);
  }

  // Format integer minor units as a two-decimal display amount.
  money(value: number) { return (value / 100).toFixed(2); }

  // Scroll to the cart after the Shop view is displayed.
  scrollToBag() {
    setTimeout(() => document.getElementById('bag')?.scrollIntoView({ behavior: 'smooth' }));
  }

  // Add a selected product to the current cart through the API.
  async add(product: Product) {
    if (!this.cart) return;
    await this.perform(async () => {
      this.cart = await this.api.addItem(this.cart!.id, product.id, Number(this.quantities[product.id] || 1));
      this.message = `${product.name} added to your bag.`;
    });
  }

  // Save an exact item quantity; reload the cart for invalid input.
  async updateQuantity(productId: string, quantity: number) {
    if (!this.cart || !Number.isInteger(quantity) || quantity < 1) return this.refreshCart();
    await this.perform(async () => { this.cart = await this.api.updateItem(this.cart!.id, productId, quantity); });
  }

  // Remove a product line from the current cart.
  async removeItem(productId: string) {
    if (!this.cart) return;
    await this.perform(async () => { this.cart = await this.api.removeItem(this.cart!.id, productId); });
  }

  // Reload the latest cart state from the backend.
  async refreshCart() {
    if (this.cart) this.cart = await this.api.cart(this.cart.id);
    this.changeDetector.markForCheck();
  }

  // Place the order with a stable key so a retry cannot duplicate the purchase.
  async checkout() {
    // Do not send checkout for a missing or empty cart.
    if (!this.cart || !this.cart.items.length) return;
    // Keep the same key if this request fails and the customer retries.
    if (!this.checkoutKey) this.checkoutKey = globalThis.crypto.randomUUID();
    await this.perform(async () => {
      // Send the optional coupon code and display the returned order.
      this.order = await this.api.checkout(this.cart!.id, this.checkoutKey, this.couponCode.trim());
      this.message = 'Order placed successfully.';
      // Clear checkout-only state after the order is confirmed.
      this.couponCode = '';
      this.checkoutKey = '';
      this.cart = null;
      // Remove the completed cart from browser storage.
      localStorage.removeItem('active-cart-id');
    });
  }

  // Start another shopping session after checkout.
  async newCart() {
    await this.perform(async () => {
      // Create a fresh cart and clear the previous receipt view.
      this.cart = await this.api.createCart();
      this.order = null;
      this.checkoutKey = '';
      localStorage.setItem('active-cart-id', this.cart.id);
    });
  }

  // Switch to the admin screen and load its data.
  async openAdmin() {
    this.view = 'admin';
    await this.loadAdmin();
  }

  // Fetch the admin catalog, coupon states, and report together.
  async loadAdmin() {
    await this.perform(async () => {
      // Load independent admin data in parallel to reduce waiting.
      const [products, coupons, report] = await Promise.all([
        this.api.adminProducts(), this.api.coupons(), this.api.report()
      ]);
      this.adminProducts = products.products;
      this.coupons = coupons.coupons;
      this.report = report;
      // Prepare editable catalog drafts and a separate stock amount for each row.
      for (const product of this.adminProducts) {
        this.drafts[product.id] ??= { name: product.name, unitPriceMinor: product.unitPriceMinor };
        this.inventoryChanges[product.id] ??= 0;
      }
    }, false);
  }

  // Create a product from the admin form, then refresh both product lists.
  async createProduct() {
    await this.perform(async () => {
      // Send validated form values as numbers to the API.
      await this.api.createProduct({ ...this.productDraft, unitPriceMinor: Number(this.productDraft.unitPriceMinor), inventory: Number(this.productDraft.inventory) });
      // Reset the form after the product was created successfully.
      this.productDraft = { name: '', unitPriceMinor: 0, inventory: 0 };
      this.message = 'Product created.';
      await Promise.all([this.loadProducts(), this.loadAdmin()]);
    });
  }

  // Save the edited product name and price.
  async saveProduct(product: Product) {
    const draft = this.drafts[product.id];
    await this.perform(async () => {
      await this.api.updateProduct(product.id, { name: draft.name, unitPriceMinor: Number(draft.unitPriceMinor) });
      this.message = 'Product updated.';
      await Promise.all([this.loadProducts(), this.loadAdmin()]);
    });
  }

  // Ask for confirmation before retiring a product from the store.
  async retireProduct(product: Product) {
    if (!confirm(`Retire “${product.name}” from the active catalog?`)) return;
    await this.perform(async () => {
      await this.api.retireProduct(product.id);
      this.message = 'Product retired.';
      await Promise.all([this.loadProducts(), this.loadAdmin()]);
    });
  }

  // Apply the selected row's stock change and clear it after success.
  async adjustStock(product: Product) {
    // Read this product's independent adjustment amount.
    const change = Number(this.inventoryChanges[product.id] || 0);
    // Do not send a no-op stock adjustment to the API.
    if (!change) {
      this.message = 'Enter a non-zero stock adjustment for this product.';
      return;
    }
    await this.perform(async () => {
      // Apply the signed amount with the admin-provided reason.
      await this.api.adjustInventory(product.id, change, this.inventoryReason);
      // Reset only this row, leaving other product adjustments untouched.
      this.inventoryChanges[product.id] = 0;
      this.message = 'Inventory adjusted.';
      await Promise.all([this.loadProducts(), this.loadAdmin()]);
    });
  }

  // Ask the backend to create a coupon if a reward milestone is eligible.
  async generateCoupon() {
    await this.perform(async () => {
      const coupon = await this.api.generateCoupon();
      this.message = `Coupon ${coupon.code} generated.`;
      await this.loadAdmin();
    });
  }

  // Confirm and cancel an available coupon without erasing its history.
  async cancelCoupon(coupon: Coupon) {
    if (!confirm(`Cancel unused coupon ${coupon.code}?`)) return;
    await this.perform(async () => {
      await this.api.cancelCoupon(coupon.code);
      this.message = 'Coupon cancelled.';
      await this.loadAdmin();
    });
  }

  // Run an async UI action while showing busy state and converting errors to messages.
  private async perform(action: () => Promise<void>, clearMessage = true) {
    // Disable repeated actions and optionally clear an old status message.
    this.busy = true;
    if (clearMessage) this.message = '';
    try {
      // Run the requested API-backed action.
      await action();
    } catch (error) {
      // Convert any failure into a customer-readable status message.
      this.showError(error);
    } finally {
      // Re-enable controls and ask Angular to refresh after async state changes.
      this.busy = false;
      this.changeDetector.markForCheck();
    }
  }

  // Turn API errors and network failures into a message shown in the UI.
  private showError(error: unknown) {
    if (error instanceof HttpErrorResponse) {
      // Prefer the backend's stable error code and message when available.
      const apiError = error.error?.error;
      this.message = apiError ? `${apiError.message} (${apiError.code})` : `Request failed (${error.status}). Is the backend running?`;
    } else {
      // Fall back to a general JavaScript message for non-HTTP errors.
      this.message = error instanceof Error ? error.message : 'Something went wrong.';
    }
  }
}
