import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const patch: { image?: string; link?: string; label?: string; order?: number } = {};
  if (typeof body.image === 'string' && body.image.trim()) patch.image = body.image.trim();
  if (typeof body.link === 'string') patch.link = body.link.trim() || '/shop';
  if (typeof body.label === 'string') patch.label = body.label.trim().slice(0, 120);
  if (Number.isFinite(body.order)) patch.order = Math.trunc(body.order);
  const updated = await db.updateGalleryItem(id, patch);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await db.deleteGalleryItem(id);
  return NextResponse.json({ ok: true });
}
