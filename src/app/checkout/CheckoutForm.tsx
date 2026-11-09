'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatPrice } from '@/lib/format';
import { fbqTrack, mirrorToCapi, newEventId, PIXEL_CURRENCY } from '@/lib/pixel';
import { gtagEvent, GA_CURRENCY } from '@/lib/gtag';

type CartItem = {
  productId: string; name: string; price: number; qty: number; image: string; slug: string;
  variantId?: string; variantName?: string;
};

const DELIVERY = { inside_dhaka: 80, outside_dhaka: 120 } as const;
type Zone = keyof typeof DELIVERY;

export default function CheckoutForm() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deliveryZone, setDeliveryZone] = useState<Zone>('inside_dhaka');
  const [form, setForm] = useState({
    customerName: '', customerEmail: '', customerPhone: '',
    shippingAddress: '', city: '',
    notes: '',
  });

  const checkoutTracked = useRef(false);

  useEffect(() => {
    let items: CartItem[] = [];
    try { items = JSON.parse(localStorage.getItem('cart') || '[]'); } catch { items = []; }
    setCart(items);

    // Fire InitiateCheckout once, when arriving at checkout with items
    if (!checkoutTracked.current && items.length > 0) {
      checkoutTracked.current = true;
      const value = items.reduce((s, i) => s + i.price * i.qty, 0);
      const eventId = newEventId('ic');
      const icData = {
        content_ids: items.map((i) => i.productId),
        content_type: 'product',
        content_name: items.map((i) => i.name).join(', '),
        contents: items.map((i) => ({ id: i.productId, quantity: i.qty, item_price: i.price })),
        num_items: items.reduce((s, i) => s + i.qty, 0),
        value,
        currency: PIXEL_CURRENCY,
      };
      fbqTrack('InitiateCheckout', icData, { eventID: eventId });
      mirrorToCapi('InitiateCheckout', eventId, icData);

      gtagEvent('begin_checkout', {
        currency: GA_CURRENCY,
        value: items.reduce((s, i) => s + i.price * i.qty, 0),
        items: items.map((i) => ({
          item_id: i.productId,
          item_name: i.name,
          item_variant: i.variantName,
          price: i.price,
          quantity: i.qty,
        })),
      });
    }
  }, []);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = DELIVERY[deliveryZone];
  const total = subtotal + shipping;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    const phoneDigits = form.customerPhone.replace(/\D/g, '');
    if (phoneDigits.length < 11) {
      setError('Please enter a valid phone number (at least 11 digits).');
      return;
    }
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          deliveryZone,
          items: cart.map((c) => ({ productId: c.productId, name: c.name, price: c.price, qty: c.qty, image: c.image, variantId: c.variantId, variantName: c.variantName })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order failed');
      localStorage.removeItem('cart');
      window.dispatchEvent(new Event('cart-updated'));
      router.push(`/order-confirmation/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-stone-600">Your cart is empty.</div>
        <Link href="/shop" className="btn btn-primary mt-4">Browse Bandanas</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-5">
        <div className="card p-5">
          <h2 className="font-semibold text-lg mb-4">Contact Details</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Full name <span className="text-red-500">*</span></label><input required className="input" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></div>
            <div><label className="label">Phone <span className="text-red-500">*</span></label><input required type="tel" className="input" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label">Email (optional)</label><input type="email" className="input" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} /></div>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-lg mb-4">Shipping Address</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="label">Address <span className="text-red-500">*</span></label><textarea required className="input" rows={2} value={form.shippingAddress} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label">City <span className="text-red-500">*</span></label><input required className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label">Order notes (optional)</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-lg mb-4">Delivery Area</h2>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 border border-stone-200 rounded-md cursor-pointer hover:bg-stone-50">
              <input type="radio" name="zone" checked={deliveryZone === 'inside_dhaka'} onChange={() => setDeliveryZone('inside_dhaka')} className="mt-1" />
              <div className="flex-1 flex justify-between gap-3">
                <div><div className="font-medium">Inside Dhaka</div><div className="text-sm text-stone-600">Delivery within Dhaka city.</div></div>
                <div className="font-semibold whitespace-nowrap">{formatPrice(DELIVERY.inside_dhaka)}</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 border border-stone-200 rounded-md cursor-pointer hover:bg-stone-50">
              <input type="radio" name="zone" checked={deliveryZone === 'outside_dhaka'} onChange={() => setDeliveryZone('outside_dhaka')} className="mt-1" />
              <div className="flex-1 flex justify-between gap-3">
                <div><div className="font-medium">Outside Dhaka</div><div className="text-sm text-stone-600">Delivery anywhere outside Dhaka.</div></div>
                <div className="font-semibold whitespace-nowrap">{formatPrice(DELIVERY.outside_dhaka)}</div>
              </div>
            </label>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-lg mb-1">Payment Method</h2>
          <div className="flex items-start gap-3 p-3 border border-stone-200 rounded-md bg-stone-50">
            <span className="mt-0.5 text-brand-600">●</span>
            <div><div className="font-medium">Cash on Delivery</div><div className="text-sm text-stone-600">Pay in cash when your order arrives.</div></div>
          </div>
        </div>
      </div>

      <aside className="card p-5 h-fit md:sticky md:top-20">
        <h2 className="font-semibold text-lg">Order Summary</h2>
        <div className="mt-4 divide-y divide-stone-100">
          {cart.map((c) => (
            <div key={c.productId} className="py-2 flex justify-between text-sm">
              <span className="truncate pr-2">{c.name} × {c.qty}</span>
              <span className="shrink-0">{formatPrice(c.price * c.qty)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-stone-200 space-y-1.5 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
          <div className="flex justify-between"><span>Delivery ({deliveryZone === 'inside_dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'})</span><span>{formatPrice(shipping)}</span></div>
          <div className="flex justify-between font-semibold text-base pt-2 border-t border-stone-200"><span>Total</span><span>{formatPrice(total)}</span></div>
        </div>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <button disabled={submitting} className="btn btn-primary w-full mt-5 disabled:opacity-50">
          {submitting ? 'Placing order…' : 'Place Order'}
        </button>
      </aside>
    </form>
  );
}
