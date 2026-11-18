'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPrice } from '@/lib/format';
import { priceCart, tierMessage, DELIVERY_CHARGES } from '@/lib/pricing';
import PriceBreakdown from '@/components/PriceBreakdown';

type CartItem = {
  productId: string; name: string; price: number; qty: number; image: string; slug: string;
  variantId?: string; variantName?: string;
};

function lineKey(item: CartItem) {
  return `${item.productId}::${item.variantId || ''}`;
}

export default function CartView({ campaignActive }: { campaignActive: boolean }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try { setCart(JSON.parse(localStorage.getItem('cart') || '[]')); } catch { setCart([]); }
    setLoaded(true);
  }, []);

  const save = (next: CartItem[]) => {
    setCart(next);
    localStorage.setItem('cart', JSON.stringify(next));
    window.dispatchEvent(new Event('cart-updated'));
  };

  const updateQty = (key: string, qty: number) => {
    if (qty <= 0) return remove(key);
    save(cart.map((c) => lineKey(c) === key ? { ...c, qty } : c));
  };
  const remove = (key: string) => save(cart.filter((c) => lineKey(c) !== key));

  if (!loaded) return null;

  if (cart.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="text-stone-600">Your cart is empty.</div>
        <Link href="/shop" className="btn btn-primary mt-4">Browse Bandanas</Link>
      </div>
    );
  }

  // Delivery zone is chosen at checkout; show the Inside Dhaka fee here.
  const priced = priceCart(cart, DELIVERY_CHARGES.inside_dhaka, campaignActive);
  const message = tierMessage(priced, campaignActive);

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-3">
        {cart.map((item) => {
          const key = lineKey(item);
          return (
            <div key={key} className="card p-4 flex gap-4">
              <Link href={`/product/${item.slug}`} className="w-20 h-20 rounded bg-stone-100 overflow-hidden shrink-0">
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/product/${item.slug}`} className="font-medium hover:text-brand-700">{item.name}</Link>
                  <button onClick={() => remove(key)} className="text-stone-400 hover:text-red-600 shrink-0 p-1 -m-1" aria-label="remove">✕</button>
                </div>
                <div className="text-sm text-stone-600 mt-1">{formatPrice(item.price)}</div>
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex items-center border border-stone-300 rounded-md">
                    <button onClick={() => updateQty(key, item.qty - 1)} className="px-3 py-1.5 hover:bg-stone-100">−</button>
                    <span className="px-3 py-1.5 border-x border-stone-300 min-w-[2.5rem] text-center">{item.qty}</span>
                    <button onClick={() => updateQty(key, item.qty + 1)} className="px-3 py-1.5 hover:bg-stone-100">+</button>
                  </div>
                  <div className="font-semibold">{formatPrice(item.price * item.qty)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <aside className="card p-5 h-fit">
        <h2 className="font-semibold text-lg">Order Summary</h2>
        {message && (
          <div className="mt-3 rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white" role="status" aria-live="polite">
            {message}
          </div>
        )}
        <div className="mt-4">
          <PriceBreakdown
            priced={priced}
            deliveryLabel="Delivery (Inside Dhaka)"
            deliveryNote={`Outside Dhaka is ${formatPrice(DELIVERY_CHARGES.outside_dhaka)}, chosen at checkout.`}
          />
        </div>
        <Link href="/checkout" className="btn btn-primary w-full mt-5">Proceed to Checkout</Link>
        <Link href="/shop" className="btn btn-ghost w-full mt-2">Continue Shopping</Link>
      </aside>
    </div>
  );
}
