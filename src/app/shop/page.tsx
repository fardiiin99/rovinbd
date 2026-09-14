import { db } from '@/lib/db';
import StoreHeader from '@/components/StoreHeader';
import StoreFooter from '@/components/StoreFooter';
import ProductCard from '@/components/ProductCard';
import PixelEvent from '@/components/PixelEvent';
import SearchBar from '@/components/SearchBar';
import Link from 'next/link';

type ShopParams = { cat?: string; q?: string; availability?: string; sort?: string };

export default async function ShopPage({ searchParams }: { searchParams: Promise<ShopParams> }) {
  const { cat, q, availability, sort } = await searchParams;
  const [content, all, cats] = await Promise.all([db.getContent(), db.listProducts(), db.listProductCategories()]);
  const catLabel = (slug: string) => cats.find((c) => c.value === slug)?.label || slug;
  const activeCat = cat?.toLowerCase();
  const query = (q || '').trim();
  const ql = query.toLowerCase();
  const stockFilter = availability === 'in-stock' || availability === 'out-of-stock' ? availability : '';
  const sortMode = ['price-low', 'price-high', 'name'].includes(sort || '') ? sort! : 'newest';

  let products = activeCat ? all.filter((p) => p.category.toLowerCase() === activeCat) : all;
  if (ql) {
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(ql) ||
        p.description.toLowerCase().includes(ql) ||
        p.category.toLowerCase().includes(ql),
    );
  }
  const isAvailable = (product: (typeof products)[number]) =>
    product.variants.length > 0 ? product.variants.some((variant) => variant.stock > 0) : product.stock > 0;

  if (stockFilter === 'in-stock') products = products.filter(isAvailable);
  if (stockFilter === 'out-of-stock') products = products.filter((product) => !isAvailable(product));

  products = [...products].sort((a, b) => {
    if (sortMode === 'price-low') return a.price - b.price;
    if (sortMode === 'price-high') return b.price - a.price;
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    return b.createdAt - a.createdAt;
  });
  const activeLabel = activeCat ? catLabel(activeCat) : undefined;
  const shopUrl = (nextCat?: string) => {
    const params = new URLSearchParams();
    if (nextCat) params.set('cat', nextCat);
    if (query) params.set('q', query);
    if (stockFilter) params.set('availability', stockFilter);
    if (sortMode !== 'newest') params.set('sort', sortMode);
    const queryString = params.toString();
    return queryString ? `/shop?${queryString}` : '/shop';
  };
  const resetParams = new URLSearchParams();
  if (activeCat) resetParams.set('cat', activeCat);
  if (query) resetParams.set('q', query);
  const resetUrl = resetParams.size ? `/shop?${resetParams.toString()}` : '/shop';

  return (
    <>
      <StoreHeader siteName={content.siteName} />

      {query && (
        <PixelEvent
          key={`search-${query}`}
          event="Search"
          mirror
          params={{ search_string: query, content_type: 'product' }}
          gaEvent="search"
          gaParams={{ search_term: query }}
        />
      )}
      {!query && activeCat && (
        <PixelEvent
          key={`cat-${activeCat}`}
          event="ViewCategory"
          custom
          mirror
          params={{
            content_category: activeLabel || activeCat,
            content_ids: products.map((p) => p.id),
            content_type: 'product',
          }}
          gaEvent="view_item_list"
          gaParams={{
            item_list_id: activeCat,
            item_list_name: activeLabel || activeCat,
            items: products.map((p, i) => ({
              item_id: p.id,
              item_name: p.name,
              item_category: p.category,
              price: p.price,
              index: i,
            })),
          }}
        />
      )}

      <main className="flex-1 max-w-6xl mx-auto px-4 py-12 w-full">
        <h1 className="font-display text-3xl font-bold">
          {query ? `Search: "${query}"` : activeLabel || 'All Products'}
        </h1>
        <p className="text-stone-600 mt-1">{products.length} products</p>

        <div className="mt-5 max-w-md">
          <SearchBar defaultValue={query} />
        </div>

        <form className="mt-6 flex flex-col gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:flex-row sm:items-end" method="get">
          {activeCat && <input type="hidden" name="cat" value={activeCat} />}
          {query && <input type="hidden" name="q" value={query} />}
          <label className="flex-1 text-sm font-medium text-stone-700">
            Availability
            <select
              name="availability"
              defaultValue={stockFilter || 'all'}
              className="mt-1.5 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="all">All products</option>
              <option value="in-stock">In stock</option>
              <option value="out-of-stock">Out of stock</option>
            </select>
          </label>
          <label className="flex-1 text-sm font-medium text-stone-700">
            Sort by
            <select
              name="sort"
              defaultValue={sortMode}
              className="mt-1.5 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="newest">Newest</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="name">Name: A to Z</option>
            </select>
          </label>
          <button type="submit" className="rounded-md bg-stone-900 px-5 py-2 text-sm font-semibold text-white hover:bg-stone-700">
            Apply
          </button>
          {(stockFilter || sortMode !== 'newest') && (
            <Link href={resetUrl} className="py-2 text-center text-sm text-stone-600 underline hover:text-stone-900">
              Reset
            </Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2 mt-6">
          <Link
            href={shopUrl()}
            className={`px-4 py-1.5 rounded-full text-sm border transition ${
              !activeCat ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-700 border-stone-300 hover:border-stone-500'
            }`}
          >
            All
          </Link>
          {cats.map((c) => (
            <Link
              key={c.value}
              href={shopUrl(c.value)}
              className={`px-4 py-1.5 rounded-full text-sm border transition ${
                activeCat === c.value
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-700 border-stone-300 hover:border-stone-500'
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-8">
          {products.map((p) => <ProductCard key={p.id} product={p} categoryLabel={catLabel(p.category)} />)}
        </div>
        {products.length === 0 && (
          <div className="text-center text-stone-500 py-20">
            {query ? `No products match "${query}".` : 'No products match these filters.'}
          </div>
        )}
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
