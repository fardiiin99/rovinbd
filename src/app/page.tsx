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
import ProductCarousel from '@/components/ProductCarousel';
import CategoryShowcase from '@/components/CategoryShowcase';
import LookGallery, { type LookItem } from '@/components/LookGallery';
import Link from 'next/link';

export default async function Home() {
  const [content, featured, categoryTiles, allProducts, galleryItems] = await Promise.all([
    db.getContent(),
    db.featuredProducts(),
    db.listCategoryTiles(),
    db.listProducts(),
    db.listGalleryItems(),
  ]);
  // Products marked "Featured" in admin; the newest products if none are.
  const recommended = featured.length > 0 ? featured : allProducts.slice(0, 10);
  // Gallery photos from Admin → Gallery; until some are added, the newest
  // products' photos (styled extra photos preferred) fill the row.
  const looks: LookItem[] = galleryItems.length > 0
    ? galleryItems
    : [
        ...allProducts.filter((p) => (p.images?.length ?? 0) > 0),
        ...allProducts.filter((p) => (p.images?.length ?? 0) === 0),
      ].map((p) => ({ id: p.id, image: p.images?.[0] || p.image, link: `/product/${p.slug}`, label: p.name }));

  return (
    <>
      <StoreHeader siteName={content.siteName} />
      <main className="flex-1">
        <div className="beyond-home">
          <Hero />
          <Marquee />
        </div>

        <CategoryShowcase tiles={categoryTiles} />

        <ProductCarousel title="Recommended for you" products={recommended} />

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
        <LookGallery items={looks} />
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
