import { db } from '@/lib/db';
import StoreHeader from '@/components/StoreHeader';
import StoreFooter from '@/components/StoreFooter';
import ProductCard from '@/components/ProductCard';
import ProductView from './ProductView';
import PixelEvent from '@/components/PixelEvent';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [content, product, cats, allProducts] = await Promise.all([
    db.getContent(),
    db.getProductBySlug(slug),
    db.listProductCategories(),
    db.listProducts(),
  ]);
  if (!product) notFound();
  const categoryLabel = cats.find((c) => c.value === product.category)?.label || product.category;
  const related = allProducts.filter((p) => p.category === product.category && p.id !== product.id);

  return (
    <>
      <StoreHeader siteName={content.siteName} />
      <PixelEvent
        key={product.id}
        event="ViewContent"
        mirror
        params={{
          content_ids: [product.id],
          content_type: 'product',
          content_name: product.name,
          content_category: product.category,
          contents: [{ id: product.id, quantity: 1, item_price: product.price }],
          value: product.price,
          currency: 'BDT',
        }}
        gaEvent="view_item"
        gaParams={{
          currency: 'BDT',
          value: product.price,
          items: [{
            item_id: product.id,
            item_name: product.name,
            item_category: product.category,
            price: product.price,
            quantity: 1,
          }],
        }}
      />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-12 w-full">
        <ProductView product={product} categoryLabel={categoryLabel} siblings={related} />

        {related.length > 0 && (
          <section className="mt-16">
            <div className="flex items-end justify-between mb-6">
              <h2 className="font-display text-2xl font-bold">More {categoryLabel}</h2>
              <Link href={`/shop?cat=${product.category}`} className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} categoryLabel={categoryLabel} />
              ))}
            </div>
          </section>
        )}
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
