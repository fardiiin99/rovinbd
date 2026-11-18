import Link from 'next/link';
import { db, isSoldOut, type Product } from '@/lib/db';
import { formatPrice } from '@/lib/format';
import DeleteButton from './DeleteButton';
import MigrateVariantsButton from './MigrateVariantsButton';
import BulkSetCostButton from './BulkSetCostButton';
import SyncReturnsButton from './SyncReturnsButton';
import { ArchiveSoldOutButton, ArchiveToggle } from './ArchiveButtons';

const totalStock = (p: Product) =>
  p.variants.length > 0 ? p.variants.reduce((n, v) => n + v.stock, 0) : p.stock;

export default async function ProductsAdmin() {
  const [products, categories] = await Promise.all([db.listProducts(), db.listProductCategories()]);
  const catLabel = (slug: string) => categories.find((c) => c.value === slug)?.label || slug;
  const active = products.filter((p) => !p.archived);
  const archived = products.filter((p) => p.archived);
  const soldOutCount = active.filter(isSoldOut).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Products</h1>
          <p className="text-stone-600 mt-1">
            {active.length} in the shop · {archived.length} archived
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Link href="/admin/products/new" className="btn btn-primary">+ Add Product</Link>
          <ArchiveSoldOutButton count={soldOutCount} />
          <MigrateVariantsButton />
          <BulkSetCostButton />
          <SyncReturnsButton />
        </div>
      </div>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-stone-50 text-stone-600 text-left">
            <tr>
              <th className="px-4 py-2">Image</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-right">Price</th>
              <th className="px-4 py-2 text-right">Cost</th>
              <th className="px-4 py-2 text-right">Stock</th>
              <th className="px-4 py-2">Featured</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {active.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2"><img src={p.image} alt="" className="w-12 h-12 object-cover rounded" /></td>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-stone-600">{catLabel(p.category)}</td>
                <td className="px-4 py-2 text-right">{formatPrice(p.price)}</td>
                <td className="px-4 py-2 text-right">{formatPrice(p.cost)}</td>
                <td className="px-4 py-2 text-right">
                  {isSoldOut(p)
                    ? <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Sold out</span>
                    : totalStock(p)}
                </td>
                <td className="px-4 py-2">{p.featured ? '★' : '—'}</td>
                <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                  <Link href={`/admin/products/${p.id}`} className="text-brand-600 hover:underline">Edit</Link>
                  <ArchiveToggle id={p.id} archived={false} />
                  <DeleteButton id={p.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active.length === 0 && <div className="p-8 text-center text-stone-500">No products in the shop.</div>}
      </div>

      <h2 className="font-display text-2xl font-bold mt-10">Archived</h2>
      <p className="text-stone-600 mt-1 text-sm">
        Hidden from the shop, the Meta catalog and checkout. Restore puts a product back in the shop
        as it is; set its stock with Edit if it is still 0.
      </p>
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <tbody className="divide-y divide-stone-100">
            {archived.map((p) => (
              <tr key={p.id} className="text-stone-600">
                <td className="px-4 py-2 w-16"><img src={p.image} alt="" className="w-12 h-12 object-cover rounded opacity-70" /></td>
                <td className="px-4 py-2 font-medium text-stone-800">{p.name}</td>
                <td className="px-4 py-2">{catLabel(p.category)}</td>
                <td className="px-4 py-2 text-right">{formatPrice(p.price)}</td>
                <td className="px-4 py-2 text-right">Stock {totalStock(p)}</td>
                <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                  <Link href={`/admin/products/${p.id}`} className="text-brand-600 hover:underline">Edit</Link>
                  <ArchiveToggle id={p.id} archived />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {archived.length === 0 && <div className="p-6 text-center text-stone-500">Nothing archived.</div>}
      </div>
    </div>
  );
}
