import { NextResponse } from 'next/server';
import { db, isSoldOut } from '@/lib/db';
import { getSession } from '@/lib/auth';

// { id, archived } archives or restores one product.
// { allSoldOut: true } archives every active product that is sold out.
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.allSoldOut === true) {
    const targets = (await db.listProducts()).filter((p) => !p.archived && isSoldOut(p));
    for (const p of targets) await db.setProductArchived(p.id, true);
    return NextResponse.json({ updated: targets.length });
  }
  if (typeof body.id !== 'string' || typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const ok = await db.setProductArchived(body.id, body.archived);
  if (!ok) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  return NextResponse.json({ updated: 1 });
}
