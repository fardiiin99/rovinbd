import { db } from '@/lib/db';
import GalleryAdmin from './GalleryAdmin';

export default async function GalleryPage() {
  const [items, products] = await Promise.all([db.listGalleryItems(), db.listProducts()]);
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Gallery</h1>
      <p className="text-stone-600 mt-1">
        The square photo row at the bottom of the homepage. Each photo has a bag button that opens the product you pick.
        The first 4 photos show on the site; change the order with the arrows.
      </p>
      <div className="mt-6">
        <GalleryAdmin
          initial={items}
          products={products.map((p) => ({ name: p.name, slug: p.slug, image: p.image }))}
        />
      </div>
    </div>
  );
}
