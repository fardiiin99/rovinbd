import Link from 'next/link';
import type { Product } from '@/lib/db';
import { formatPrice } from '@/lib/format';

export default function ProductCard({ product, categoryLabel }: { product: Product; categoryLabel?: string }) {
  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="card overflow-hidden">
        <div className="aspect-square bg-stone-100 overflow-hidden">
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-105 transition"
          />
        </div>
        <div className="p-4">
          <div className="text-xs uppercase tracking-wider text-stone-500">{categoryLabel || product.category}</div>
          <div className="mt-1 font-medium text-stone-900 group-hover:text-brand-700">{product.name}</div>
          <div className="mt-2 flex items-center justify-between">
            <div className="font-semibold text-brand-700">{formatPrice(product.price)}</div>
            {product.stock === 0 && <span className="text-xs text-red-600">Out of stock</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
