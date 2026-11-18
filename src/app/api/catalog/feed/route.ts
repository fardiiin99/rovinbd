import { db, type Product } from '@/lib/db';

// Public product feed for Meta Commerce Manager (and other catalog platforms).
// One row per product; `id` column = product.id so it matches the content_ids
// the pixel/CAPI send. Connect via Commerce Manager → Catalog → Data Feed.

function csvField(value: string): string {
  // RFC-4180: wrap in quotes, double any internal quotes.
  return `"${String(value).replace(/"/g, '""')}"`;
}

function availability(p: Product): string {
  const inStock = p.variants.length > 0
    ? p.variants.reduce((s, v) => s + v.stock, 0) > 0
    : p.stock > 0;
  return inStock ? 'in stock' : 'out of stock';
}

export async function GET(req: Request) {
  const host = req.headers.get('host') || 'www.rovinbd.com';
  const baseUrl = `https://${host}`;
  const products = await db.listStoreProducts();

  const absImage = (image: string) =>
    image.startsWith('http') ? image : `${baseUrl}${image.startsWith('/') ? '' : '/'}${image}`;

  const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
  const rows = products.map((p) => [
    csvField(p.id),
    csvField(p.name),
    csvField(p.description),
    csvField(availability(p)),
    csvField('new'),
    csvField(`${p.price} BDT`),
    csvField(`${baseUrl}/product/${p.slug}`),
    csvField(absImage(p.image)),
    csvField('Rovin.'),
  ].join(','));

  const csv = [header.join(','), ...rows].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
