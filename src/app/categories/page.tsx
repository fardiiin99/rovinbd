import type { Metadata } from 'next';
import Link from 'next/link';
import StoreFooter from '@/components/StoreFooter';
import StoreHeader from '@/components/StoreHeader';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Categories | Rovin.',
  description: 'Explore Rovin bandanas by collection and find your style.',
};

export default async function CategoriesPage() {
  const [content, categories, tiles, products] = await Promise.all([
    db.getContent(),
    db.listProductCategories(),
    db.listCategoryTiles(),
    db.listProducts(),
  ]);

  const productTiles = tiles.filter((tile) => tile.kind === 'product');

  return (
    <>
      <StoreHeader siteName={content.siteName} />
      <main className="flex-1">
        <section className="border-b border-stone-200 bg-gradient-to-br from-brand-50 via-[#fffaf3] to-amber-50">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-600">
              Find your style
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl">
              Shop by category
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-stone-600">
              From timeless paisley to bold prints and everyday essentials, explore the collection made for you.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
          {categories.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((category) => {
                const tile = productTiles.find((item) => {
                  const match = item.link.match(/[?&]cat=([^&]+)/);
                  return match && decodeURIComponent(match[1]) === category.value;
                });
                const count = products.filter(
                  (product) => product.category.toLowerCase() === category.value.toLowerCase(),
                ).length;

                return (
                  <Link
                    key={category.value}
                    href={`/shop?cat=${encodeURIComponent(category.value)}`}
                    className="group relative isolate min-h-80 overflow-hidden rounded-2xl bg-stone-900 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl"
                    style={{ backgroundColor: tile?.bgColor || '#292524' }}
                  >
                    <img
                      src={tile?.image || '/placeholder.svg'}
                      alt={`${category.label} bandanas`}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-black/5" />

                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6 text-white">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/70">
                          {count} {count === 1 ? 'product' : 'products'}
                        </p>
                        <h2 className="mt-1 font-display text-2xl font-bold">{category.label}</h2>
                      </div>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-900 transition group-hover:translate-x-1" aria-hidden="true">
                        →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-stone-200 bg-white p-12 text-center text-stone-500">
              Categories will appear here when they are added.
            </div>
          )}

          <div className="mt-10 text-center">
            <Link href="/shop" className="btn btn-outline">
              View all bandanas
            </Link>
          </div>
        </section>
      </main>
      <StoreFooter
        siteName={content.siteName}
        email={content.contactEmail}
        phone={content.contactPhone}
        address={content.contactAddress}
      />
    </>
  );
}
