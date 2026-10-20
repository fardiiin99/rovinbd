import { NextResponse } from 'next/server';
import { db, type ProductVariant, sanitizeImages } from '@/lib/db';
import { getSession } from '@/lib/auth';

function sanitizeVariants(raw: unknown): ProductVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((vRaw): ProductVariant => {
      const v = (vRaw || {}) as Record<string, unknown>;
      return {
        id: typeof v.id === 'string' && v.id ? v.id : 'v_' + Math.random().toString(36).slice(2, 9),
        name: typeof v.name === 'string' ? v.name.trim() : '',
        image: typeof v.image === 'string' && v.image ? v.image : '/placeholder.svg',
        stock: Math.max(0, Number(v.stock) || 0),
      };
    })
    .filter((v) => v.name);
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const p = await db.createProduct({
    name: body.name, description: body.description, price: Number(body.price) || 0,
    cost: Number(body.cost) || 0,
    stock: Number(body.stock) || 0, image: body.image || '/placeholder.svg',
    category: body.category || 'classic', featured: !!body.featured,
    variants: sanitizeVariants(body.variants),
    variantStyle: body.variantStyle === 'size' ? 'size' : 'image',
    images: sanitizeImages(body.images),
  });
  return NextResponse.json(p);
}
