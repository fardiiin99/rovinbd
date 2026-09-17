import type { Metadata } from 'next';
import Hero from '@/components/Hero';
import Marquee from '@/components/Marquee';
import './beyond.css';

export const metadata: Metadata = {
  title: 'ROVIN | Bandanas for Your Everyday Style',
  description: 'Wear your own style with ROVIN bandanas. Bold prints for everyday looks. Tie it your way at rovinbd.com.',
};

import { db } from '@/lib/db';
import StoreHeader from '@/components/StoreHeader';
import StoreFooter from '@/components/StoreFooter';
import ProductCard from '@/components/ProductCard';
import CategoryShowcase from '@/components/CategoryShowcase';
import Link from 'next/link';

export default async function Home() {
  const [content, featured, categoryTiles, cats] = await Promise.all([
    db.getContent(),
    db.featuredProducts(),
    db.listCategoryTiles(),
    db.listProductCategories(),
  ]);
  const catLabel = (slug: string) => cats.find((c) => c.value === slug)?.label || slug;

  return (
    <>
      <StoreHeader siteName={content.siteName} />
      <main className="flex-1">
        <div className="beyond-home">
          <Hero />
          <Marquee />
        </div>

        <CategoryShowcase tiles={categoryTiles} />

        <section className="max-w-6xl mx-auto px-4 py-16">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="font-display text-3xl font-bold">Featured Bandanas</h2>
              <p className="text-stone-600 mt-1">Hand-picked favourites from our latest collection.</p>
            </div>
            <Link href="/shop" className="text-brand-600 hover:text-brand-700 font-medium hidden sm:inline">View all →</Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {featured.map((p) => <ProductCard key={p.id} product={p} categoryLabel={catLabel(p.category)} />)}
          </div>
        </section>

        <section className="relative bg-stone-900 text-white overflow-hidden">
          <img
            src="/cta-background.jpg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover opacity-20"
          />
          <div className="relative z-10 max-w-6xl mx-auto px-4 py-16 text-center">
            <h2 className="font-display text-3xl font-bold">{content.tagline}</h2>
            <p className="mt-3 text-stone-300 max-w-xl mx-auto">Premium cotton. Hand-finished edges. Made to last and made to stand out.</p>
            <Link href="/shop" className="btn btn-primary mt-6">Shop Now</Link>
          </div>
        </section>
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
