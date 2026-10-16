import { NextResponse } from 'next/server';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { sql } from '@/lib/pg';

// Image bytes live in Postgres (hosted Supabase), and every read counts against its
// egress quota — the quota that already took storage offline once. Uploaded images
// are immutable (UUID per upload), so cache each one on local disk after the first
// read and serve repeat requests without touching the database.
const CACHE_DIR = process.env.IMAGE_CACHE_DIR || path.join(os.tmpdir(), 'rovin-image-cache');
const HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });

  const dataPath = path.join(CACHE_DIR, id);
  const typePath = `${dataPath}.type`;

  try {
    const [data, contentType] = await Promise.all([readFile(dataPath), readFile(typePath, 'utf8')]);
    return new NextResponse(new Uint8Array(data), { headers: { ...HEADERS, 'Content-Type': contentType } });
  } catch {
    // cache miss — fall through to the database
  }

  const result = await sql`SELECT content_type, data FROM uploaded_images WHERE id = ${id} LIMIT 1`;
  const image = result.rows[0];
  if (!image) return new NextResponse('Not found', { status: 404 });

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // Write-then-rename keeps concurrent readers from seeing a partial file; the type
    // file lands last, and a hit requires both, so a hit is always complete.
    const tmp = `${dataPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, image.data);
    await rename(tmp, dataPath);
    await writeFile(`${typePath}.tmp`, image.content_type);
    await rename(`${typePath}.tmp`, typePath);
  } catch (err) {
    console.error('[images] cache write failed', id, (err as Error).message);
  }

  return new NextResponse(new Uint8Array(image.data), {
    headers: { ...HEADERS, 'Content-Type': image.content_type },
  });
}
