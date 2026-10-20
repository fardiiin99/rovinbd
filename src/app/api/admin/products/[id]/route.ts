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

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const updated = await db.updateProduct(id, {
    name: body.name, description: body.description, price: Number(body.price) || 0,
    cost: Number(body.cost) || 0,
    stock: Number(body.stock) || 0, image: body.image, category: body.category, featured: !!body.featured,
    variants: sanitizeVariants(body.variants),
    variantStyle: body.variantStyle === 'size' ? 'size' : 'image',
    ...(Array.isArray(body.images) ? { images: sanitizeImages(body.images) } : {}),
  });
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await db.deleteProduct(id);
  return NextResponse.json({ ok: true });
}
