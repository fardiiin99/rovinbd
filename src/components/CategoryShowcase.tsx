import Link from 'next/link';
import type { CategoryTile } from '@/lib/db';

export default function CategoryShowcase({ tiles }: { tiles: CategoryTile[] }) {
  const features = tiles.filter((t) => t.kind === 'feature').slice(0, 2);
  const products = tiles.filter((t) => t.kind === 'product').slice(0, 4);

  return (
    <section className="max-w-7xl mx-auto px-4 py-12 md:py-16">
      {/* Two wide feature banners */}
      {features.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {features.map((t) => (
            <Link
              key={t.id}
              href={t.link || '/shop'}
              className="group relative block aspect-[16/7] overflow-hidden rounded-xl"
              style={{ backgroundColor: t.bgColor }}
            >
              <img
                src={t.image}
                alt={t.label}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-black/25" />
              <div className="absolute inset-0 flex items-center justify-center text-center px-6">
                <div>
                  <div className="font-display text-white text-xl sm:text-2xl md:text-4xl font-bold tracking-wider drop-shadow-lg">
                    {t.label}
                  </div>
                  {t.sublabel && (
                    <div className="mt-2 text-white/95 text-xs sm:text-sm md:text-base tracking-[0.25em] drop-shadow">
                      {t.sublabel}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Four colored product tiles */}
      {products.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mt-4 md:mt-6">
          {products.map((t) => (
            <Link
              key={t.id}
              href={t.link || '/shop'}
              className="group relative block aspect-[4/3] overflow-hidden rounded-xl"
              style={{ backgroundColor: t.bgColor }}
            >
              <img
                src={t.image}
                alt={t.label}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
              {t.label && (
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <span className="font-display text-white text-sm md:text-base font-bold uppercase tracking-wider drop-shadow mix-blend-difference">
                    {t.label}
                  </span>
                  <span className="text-white text-xs md:text-sm group-hover:translate-x-1 transition-transform drop-shadow mix-blend-difference">
                    Shop →
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
