'use client';
import { useEffect, useState } from 'react';
import type { Product, ProductVariant } from '@/lib/db';
import { fbqTrack, mirrorToCapi, newEventId, PIXEL_CURRENCY } from '@/lib/pixel';
import { gtagEvent, GA_CURRENCY } from '@/lib/gtag';

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
    const cart = JSON.parse(localStorage.getItem('cart') || '[]') as CartItem[];
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
  };

  const isSizeVariant = product.variantStyle === 'size';

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

      <button
        onClick={addToCart}
        disabled={outOfStock || mustPickVariant}
        className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {outOfStock ? 'Out of stock' : mustPickVariant ? (isSizeVariant ? 'Choose a size' : 'Choose a style') : added ? 'Added to cart ✓' : 'Add to Cart'}
      </button>
    </div>
  );
}
