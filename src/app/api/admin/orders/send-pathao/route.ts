import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { createPathaoOrder } from '@/lib/pathao';

export const maxDuration = 60;

type Result = { id: string; orderNumber?: number; ok: boolean; consignmentId?: string; error?: string; skipped?: boolean };

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
    if (order.pathaoConsignmentId) {
      results.push({ id, orderNumber: order.orderNumber, ok: true, consignmentId: order.pathaoConsignmentId, skipped: true });
      continue;
    }
    const result = await createPathaoOrder({
      merchantOrderId: String(order.orderNumber),
      recipientName: order.customerName,
      recipientPhone: order.customerPhone,
      recipientAddress: `${order.shippingAddress}, ${order.city}`,
      amountToCollect: order.total,
      itemQuantity: order.items.reduce((s, i) => s + i.qty, 0),
      itemWeight: 0.5,
      specialInstruction: order.notes || '',
    });
    if (result.ok) {
      await db.updateOrderPathaoConsignment(order.id, result.consignmentId, result.deliveryFee);
      results.push({ id, orderNumber: order.orderNumber, ok: true, consignmentId: result.consignmentId });
    } else {
      results.push({ id, orderNumber: order.orderNumber, ok: false, error: result.error });
    }
  }

  return NextResponse.json({ results });
}
