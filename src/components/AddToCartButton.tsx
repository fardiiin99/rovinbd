'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Product, ProductVariant } from '@/lib/db';
import { fbqTrack, mirrorToCapi, newEventId, PIXEL_CURRENCY } from '@/lib/pixel';
import { gtagEvent, GA_CURRENCY } from '@/lib/gtag';
import { useSaleActive } from '@/components/SaleContext';
import { blackFridayPercent, priceCart, tierMessage } from '@/lib/pricing';
import { formatPrice } from '@/lib/format';

const readCart = (): CartItem[] => {
  try { return JSON.parse(localStorage.getItem('cart') || '[]') as CartItem[]; } catch { return []; }
};

type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  image: string;
  slug: string;
  variantId?: string;
  variantName?: string;
};

export default function AddToCartButton({
  product,
  onVariantSelect,
}: {
  product: Product;
  onVariantSelect?: (variant: ProductVariant | null) => void;
}) {
  const hasVariants = product.variants.length > 0;
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const saleActive = useSaleActive();
  const [cartCount, setCartCount] = useState(0);
  const [toast, setToast] = useState<{ name: string; image: string; qty: number; cart: CartItem[] } | null>(null);

  // Items already in the cart, kept in sync with other tabs and the header.
  useEffect(() => {
    const update = () => setCartCount(readCart().reduce((n, c) => n + c.qty, 0));
    update();
    window.addEventListener('cart-updated', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('cart-updated', update);
      window.removeEventListener('storage', update);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const selectedVariant = hasVariants
    ? product.variants.find((v) => v.id === selectedVariantId) || null
    : null;

  // Notify parent when selection changes (so product page can swap the main image).
  useEffect(() => {
    if (onVariantSelect) onVariantSelect(selectedVariant);
  }, [selectedVariant, onVariantSelect]);

  const availableStock = hasVariants ? (selectedVariant?.stock ?? 0) : product.stock;
  const outOfStock = hasVariants
    ? (selectedVariant ? selectedVariant.stock === 0 : product.variants.every((v) => v.stock === 0))
    : product.stock === 0;
  const mustPickVariant = hasVariants && !selectedVariant;

  const addToCart = () => {
    if (mustPickVariant) return;
    const cart = readCart();
    const variantId = selectedVariant?.id;
    const existing = cart.find((c) => c.productId === product.id && (c.variantId || '') === (variantId || ''));
    const image = selectedVariant?.image || product.image;
    const displayName = selectedVariant ? `${product.name} — ${selectedVariant.name}` : product.name;
    if (existing) existing.qty += qty;
    else cart.push({
      productId: product.id, name: displayName, price: product.price, qty, image, slug: product.slug,
      variantId, variantName: selectedVariant?.name,
    });
    localStorage.setItem('cart', JSON.stringify(cart));
    window.dispatchEvent(new Event('cart-updated'));

    // Catalog match key must be the bare product.id (variant detail lives in
    // content_name only) so content_ids match the Meta product feed.
    const eventId = newEventId('atc');
    const atcData = {
      content_ids: [product.id],
      content_type: 'product',
      content_name: displayName,
      content_category: product.category,
      contents: [{ id: product.id, quantity: qty, item_price: product.price }],
      num_items: qty,
      value: product.price * qty,
      currency: PIXEL_CURRENCY,
    };
    fbqTrack('AddToCart', atcData, { eventID: eventId });
    mirrorToCapi('AddToCart', eventId, atcData);

    gtagEvent('add_to_cart', {
      currency: GA_CURRENCY,
      value: product.price * qty,
      items: [{
        item_id: product.id,
        item_name: displayName,
        item_category: product.category,
        item_variant: selectedVariant?.name,
        price: product.price,
        quantity: qty,
      }],
    });

    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    setToast({ name: displayName, image, qty, cart });
  };

  const isSizeVariant = product.variantStyle === 'size';

  // Sale hint based on what is already in the cart: "Add 1 more to get 20% off".
  const next = priceCart([{ price: product.price, qty: cartCount }], 0, true).nextTier;
  const saleHint = !saleActive || outOfStock ? '' : next
    ? `Add ${next.itemsNeeded}${cartCount > 0 ? ' more' : ' items'} to get ${next.percent}% off`
    : `You've unlocked ${blackFridayPercent(cartCount)}% off`;

  const toastPriced = toast
    ? priceCart(toast.cart.map((c) => ({ price: c.price, qty: c.qty })), 0, saleActive)
    : null;

  return (
    <div className="space-y-4">
      {hasVariants && (
        <div>
          <label className="text-sm font-medium text-stone-700 block mb-2">
            {isSizeVariant
              ? (selectedVariant ? <>Size: <span className="font-semibold">{selectedVariant.name}</span></> : 'Choose a size')
              : (selectedVariant ? <>Selected: <span className="font-semibold">{selectedVariant.name}</span></> : 'Choose a style')}
          </label>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const isActive = selectedVariantId === v.id;
              const empty = v.stock === 0;
              if (isSizeVariant) {
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => !empty && setSelectedVariantId(v.id)}
                    disabled={empty}
                    title={empty ? `${v.name} (out of stock)` : v.name}
                    className={`min-w-[3rem] px-4 py-2 rounded-md border-2 text-sm font-semibold transition ${
                      isActive ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white text-stone-800 hover:border-stone-500'
                    } ${empty ? 'opacity-40 cursor-not-allowed line-through' : ''}`}
                  >
                    {v.name}
                  </button>
                );
              }
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => !empty && setSelectedVariantId(v.id)}
                  disabled={empty}
                  className={`relative rounded-md border-2 transition ${
                    isActive ? 'border-brand-600 ring-2 ring-brand-200' : 'border-stone-200 hover:border-stone-400'
                  } ${empty ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={empty ? `${v.name} (out of stock)` : v.name}
                >
                  <img src={v.image} alt={v.name} className="w-14 h-14 object-cover rounded-sm" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-stone-700">Quantity</label>
        <div className="inline-flex items-center border border-stone-300 rounded-md">
          <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="px-3 py-1.5 hover:bg-stone-100">−</button>
          <span className="px-4 py-1.5 border-x border-stone-300">{qty}</span>
          <button type="button" onClick={() => setQty(Math.min(availableStock || 1, qty + 1))} className="px-3 py-1.5 hover:bg-stone-100">+</button>
        </div>
      </div>

      <div>
      {saleHint && (
        <div className="rounded-t-md bg-black px-3 py-1.5 text-center text-xs sm:text-sm font-semibold tracking-wide text-white" aria-live="polite">
          <span className="text-amber-300">BLACK FRIDAY</span> · {saleHint}
        </div>
      )}
      <button
        onClick={addToCart}
        disabled={outOfStock || mustPickVariant}
        className={`btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed ${saleHint ? 'rounded-t-none' : ''}`}
      >
        {outOfStock ? 'Out of stock' : mustPickVariant ? (isSizeVariant ? 'Choose a size' : 'Choose a style') : added ? 'Added to cart ✓' : 'Add to Cart'}
      </button>
      </div>

      {toast && toastPriced && (
        <div
          role="status"
          className="cart-toast fixed inset-x-3 top-3 z-50 sm:left-auto sm:right-4 sm:top-4 sm:w-96 rounded-lg bg-white p-4 shadow-2xl ring-1 ring-stone-200"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-green-700">✓ Added to cart</p>
            <button type="button" onClick={() => setToast(null)} aria-label="Close" className="-m-1 p-1 text-stone-500 hover:text-stone-900">✕</button>
          </div>
          <div className="mt-3 flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toast.image} alt="" className="h-16 w-16 rounded object-cover bg-stone-100" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-stone-900 line-clamp-2">{toast.name}</p>
              <p className="text-stone-600">Qty {toast.qty} · {toastPriced.itemCount} item{toastPriced.itemCount === 1 ? '' : 's'} in cart</p>
              {toastPriced.discountPercent > 0 && (
                <p className="font-semibold text-green-700">{toastPriced.discountPercent}% off · you save {formatPrice(toastPriced.discountAmount)}</p>
              )}
            </div>
          </div>
          {saleActive && (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{tierMessage(toastPriced, true)}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setToast(null)} className="btn btn-outline text-sm">Keep shopping</button>
            <Link href="/cart" className="btn btn-primary text-sm">View cart</Link>
          </div>
        </div>
      )}
    </div>
  );
}
