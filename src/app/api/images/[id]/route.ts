import { NextResponse } from 'next/server';
import { sql } from '@/lib/pg';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });

  const result = await sql`SELECT content_type, data FROM uploaded_images WHERE id = ${id} LIMIT 1`;
  const image = result.rows[0];
  if (!image) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.content_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
