'use client';
import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { Product, ProductVariant } from '@/lib/db';
import { formatPrice } from '@/lib/format';
import AddToCartButton from '@/components/AddToCartButton';

export default function ProductView({
  product,
  categoryLabel,
  siblings,
}: {
  product: Product;
  categoryLabel: string;
  siblings: Product[];
}) {
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const hasVariants = product.variants.length > 0;

  const gallery = [product.image, ...(product.images || [])];
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const variantImage = product.variantStyle === 'size' ? null : selectedVariant?.image;

  // Stable identity: AddToCartButton lists this in an effect's deps, so a fresh
  // function each render would re-fire it and wipe the chosen thumbnail.
  const selectVariant = useCallback((v: ProductVariant | null) => {
    setSelectedVariant(v);
    setActiveImage(null);
  }, []);
  const displayImage = activeImage || variantImage || product.image;
  const displayStock = hasVariants
    ? (selectedVariant ? selectedVariant.stock : product.variants.reduce((s, v) => s + v.stock, 0))
    : product.stock;
  const inStock = displayStock > 0;

  return (
    <div className="grid md:grid-cols-2 gap-10">
      <div>
        <div className="aspect-square rounded-xl overflow-hidden bg-stone-100">
          <img src={displayImage} alt={product.name} className="w-full h-full object-cover" />
        </div>
        {gallery.length > 1 && (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {gallery.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setActiveImage(src)}
                className={`aspect-square rounded-md overflow-hidden border-2 transition ${
                  src === displayImage ? 'border-brand-600' : 'border-stone-200 hover:border-stone-400'
                }`}
                aria-label={`Show photo ${i + 1}`}
              >
                <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-stone-500">{categoryLabel}</div>
        <h1 className="font-display text-3xl font-bold mt-1">{product.name}</h1>
        <div className="mt-3 text-2xl font-semibold text-brand-700">{formatPrice(product.price)}</div>
        <p className="mt-6 text-stone-700 leading-relaxed">{product.description}</p>
        <div className="mt-6 flex items-center gap-2 text-sm">
          {inStock ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-stone-700">In stock</span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-stone-700">Out of stock</span>
            </>
          )}
        </div>
        {siblings.length > 0 && (
          <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-3">Other {categoryLabel}</div>
            <div className="grid grid-cols-4 gap-2">
              {[product, ...siblings].map((s) => {
                const isCurrent = s.id === product.id;
                return (
                  <Link
                    key={s.id}
                    href={`/product/${s.slug}`}
                    className={`group block rounded-md border-2 transition overflow-hidden ${
                      isCurrent
                        ? 'border-brand-600 ring-2 ring-brand-200 pointer-events-none'
                        : 'border-stone-200 hover:border-brand-600 hover:ring-2 hover:ring-brand-200'
                    }`}
                    title={s.name}
                  >
                    <div className="aspect-square bg-stone-100">
                      <img src={s.image} alt={s.name} className="w-full h-full object-cover" />
                    </div>
                    <div className={`px-1 py-1 text-[11px] leading-tight truncate text-center ${isCurrent ? 'text-brand-700 font-semibold' : 'text-stone-700 group-hover:text-brand-700'}`}>
                      {s.name}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-6">
          <AddToCartButton product={product} onVariantSelect={selectVariant} />
        </div>
      </div>
    </div>
  );
}
