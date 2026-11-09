import { NextResponse } from 'next/server';
import { db, type Order } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { sendCapiEvent } from '@/lib/capi';
import { cityToDivision } from '@/lib/bd-divisions';

async function fireStatusCapi(order: Order, eventName: 'PurchaseConfirmed' | 'Refunded') {
  const [firstName, ...rest] = String(order.customerName).trim().split(/\s+/);
  const lastName = rest.join(' ');

  await sendCapiEvent({
    eventName,
    eventId: `${eventName.toLowerCase()}_${order.id}`,
    userData: {
      email: order.customerEmail || undefined,
      phone: order.customerPhone,
      firstName,
      lastName,
      city: order.city,
      state: cityToDivision(order.city),
      country: 'bd',
      externalId: order.customerId,
    },
    customData: {
      currency: 'BDT',
      value: order.total,
      content_type: 'product',
      content_ids: order.items.map((i) => i.productId),
      contents: order.items.map((i) => ({ id: i.productId, quantity: i.qty, item_price: i.price })),
      num_items: order.items.reduce((s, i) => s + i.qty, 0),
      order_id: String(order.orderNumber),
    },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const newStatus = body.status as Order['status'];
  const before = await db.getOrder(id);
  const updated = await db.updateOrderStatus(id, newStatus);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Status-driven CAPI: only fire when transitioning into the new state
  if (before && before.status !== newStatus) {
    if (newStatus === 'received') await fireStatusCapi(updated, 'PurchaseConfirmed');
    else if (newStatus === 'returned') {
      await fireStatusCapi(updated, 'Refunded');
      await db.restockOrderItems(updated.items);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await db.deleteOrder(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
