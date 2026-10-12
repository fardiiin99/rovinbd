import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { notifySmsCustomer } from '@/lib/notify';

export const maxDuration = 60;

type Result = { id: string; orderNumber?: number; ok: boolean; error?: string };

export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'No orders selected' }, { status: 400 });

  const results: Result[] = [];
  for (const id of ids) {
    const order = await db.getOrder(id);
    if (!order) {
      results.push({ id, ok: false, error: 'Order not found' });
      continue;
    }
    const result = await notifySmsCustomer(order);
    results.push({ id, orderNumber: order.orderNumber, ok: result.ok, error: result.error });
  }

  return NextResponse.json({ results });
}
