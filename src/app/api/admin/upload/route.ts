import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/pg';
import { randomUUID } from 'crypto';

let imageTableReady: Promise<unknown> | null = null;

function ensureImageTable() {
  imageTableReady ??= sql.query(`
    CREATE TABLE IF NOT EXISTS uploaded_images (
      id UUID PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return imageTableReady;
}

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const startedAt = Date.now();
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Not an image' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Image must be smaller than 10 MB' }, { status: 413 });

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) ? ext : 'png';
  const filename = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    await ensureImageTable();
    const id = randomUUID();
    await sql`INSERT INTO uploaded_images (id, content_type, data) VALUES (${id}, ${file.type}, ${Buffer.from(arrayBuffer)})`;
    console.log('[admin/upload] complete', { id, bytes: file.size, storage: 'postgres', durationMs: Date.now() - startedAt });
    return NextResponse.json({ url: `/api/images/${id}` });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  console.log('[admin/upload] uploading', { filename, bytes: file.size });
  const { error } = await supabase.storage.from('images').upload(filename, arrayBuffer, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false,
  });

  if (error) {
    console.error('[admin/upload] failed', { filename, error: error.message, durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = supabase.storage.from('images').getPublicUrl(filename);
  console.log('[admin/upload] complete', { filename, durationMs: Date.now() - startedAt });
  return NextResponse.json({ url: data.publicUrl });
}
