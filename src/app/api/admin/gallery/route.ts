import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  if (!image) return NextResponse.json({ error: 'A photo is required' }, { status: 400 });
  const item = await db.createGalleryItem({
    image,
    link: typeof body.link === 'string' && body.link.trim() ? body.link.trim() : '/shop',
    label: typeof body.label === 'string' ? body.label.trim().slice(0, 120) : '',
  });
  return NextResponse.json(item);
}
