'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Product } from '@/lib/db';
import { formatPrice } from '@/lib/format';

// A horizontally scrolling row of product cards with arrow buttons and a
// "Shop All" link underneath. Swipes on touch screens; arrows on desktop.
export default function ProductCarousel({
  title,
  products,
  shopAllHref = '/shop',
}: {
  title: string;
  products: Product[];
  shopAllHref?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const updateArrows = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  if (products.length === 0) return null;

  return (
    <section className="w-full py-12 md:py-16">
      <h2 className="px-4 md:px-8 mb-6 text-center text-xl md:text-2xl font-medium tracking-[0.2em] uppercase text-stone-900">
        {title}
      </h2>

      <div className="relative">
        <div
          ref={trackRef}
          onScroll={updateArrows}
          className="flex gap-3 md:gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth px-4 md:px-8 scroll-px-4 md:scroll-px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {products.map((p) => (
            <CarouselCard key={p.id} product={p} />
          ))}
        </div>

        <ArrowButton side="left" visible={canPrev} onClick={() => scrollByPage(-1)} />
        <ArrowButton side="right" visible={canNext} onClick={() => scrollByPage(1)} />
      </div>

      <div className="mt-8 flex justify-center">
        <Link
          href={shopAllHref}
          className="border border-stone-900 px-8 py-3 text-xs font-semibold tracking-[0.2em] uppercase text-stone-900 transition-colors hover:bg-stone-900 hover:text-white"
        >
          Shop All
        </Link>
      </div>
    </section>
  );
}

function CarouselCard({ product }: { product: Product }) {
  const swatches = product.variantStyle === 'size' ? [] : product.variants.filter((v) => v.image).slice(0, 5);
  const [shownImage, setShownImage] = useState(product.image);
  const [activeVariant, setActiveVariant] = useState<string | null>(null);
  const stock = product.variants.length > 0
    ? product.variants.reduce((s, v) => s + v.stock, 0)
    : product.stock;

  return (
    <div className="snap-start shrink-0 w-[44vw] sm:w-[30vw] md:w-[calc((100%-3*1rem)/4)] lg:w-[calc((100%-4*1rem)/5)]">
      <Link href={`/product/${product.slug}`} className="group block">
        <div className="relative aspect-square overflow-hidden bg-[#ebebeb]">
          <img
            src={shownImage}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          {stock <= 0 && (
            <span className="absolute left-2 top-2 bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-700">
              Sold out
            </span>
          )}
        </div>
        <div className="mt-3 text-sm md:text-[15px] leading-snug text-stone-900 line-clamp-2 group-hover:underline underline-offset-2">
          {product.name}
        </div>
        <div className="mt-1 text-xs tracking-wide text-stone-600">{formatPrice(product.price)} BDT</div>
      </Link>

      {swatches.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {swatches.map((v) => (
            <button
              key={v.id}
              type="button"
              title={v.name}
              aria-label={`Show ${v.name}`}
              onMouseEnter={() => setShownImage(v.image)}
              onFocus={() => setShownImage(v.image)}
              onClick={() => {
                setShownImage(v.image);
                setActiveVariant(v.id);
              }}
              className={`h-7 w-7 overflow-hidden rounded-full border p-0.5 transition-colors ${
                activeVariant === v.id ? 'border-stone-900' : 'border-stone-300 hover:border-stone-600'
              }`}
            >
              <img src={v.image} alt="" className="h-full w-full rounded-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrowButton({ side, visible, onClick }: { side: 'left' | 'right'; visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous products' : 'Next products'}
      className={`absolute top-[calc((100%-5rem)/2)] -translate-y-1/2 ${side === 'left' ? 'left-1 md:left-2' : 'right-1 md:right-2'} hidden md:flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-stone-900 shadow-md transition-opacity hover:bg-white ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
