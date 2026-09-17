import { NextResponse, after } from 'next/server';
import { db, DELIVERY_CHARGES, type DeliveryZone } from '@/lib/db';
import { sendCapiEvent, extractClientContext } from '@/lib/capi';
import { cityToDivision } from '@/lib/bd-divisions';
import { notifyOrderPlaced } from '@/lib/notify';
import { createPathaoOrder } from '@/lib/pathao';
import { sendGA4Purchase, extractGA4ClientId } from '@/lib/ga4';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const required = ['customerName', 'customerPhone', 'shippingAddress', 'city', 'items'];
    for (const k of required) if (!body[k]) return NextResponse.json({ error: `Missing ${k}` }, { status: 400 });
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    if (String(body.customerPhone).replace(/\D/g, '').length < 11) {
      return NextResponse.json({ error: 'Please enter a valid phone number (at least 11 digits).' }, { status: 400 });
    }

    const deliveryZone: DeliveryZone = body.deliveryZone === 'outside_dhaka' ? 'outside_dhaka' : 'inside_dhaka';

    const items = body.items.map((c: { productId: string; name: string; price: number; qty: number; image: string; variantId?: string; variantName?: string }) => ({
      productId: c.productId, name: c.name, price: Number(c.price) || 0, qty: Number(c.qty) || 0, image: c.image,
      variantId: c.variantId || undefined, variantName: c.variantName || undefined,
    }));
    const subtotal = items.reduce((s: number, i: { price: number; qty: number }) => s + i.price * i.qty, 0);
    const shipping = DELIVERY_CHARGES[deliveryZone];
    const total = subtotal + shipping;

    const order = await db.createOrder({
      customerName: body.customerName,
      customerEmail: body.customerEmail || '',
      customerPhone: body.customerPhone,
      shippingAddress: body.shippingAddress,
      city: body.city,
      postalCode: body.postalCode || '',
      notes: body.notes || '',
      items,
      subtotal,
      shipping,
      total,
      paymentMethod: 'cod',
      deliveryZone,
    });

    const ctx = extractClientContext(req);
    const [firstName, ...rest] = String(body.customerName).trim().split(/\s+/);
    const lastName = rest.join(' ');
    const origin = req.headers.get('origin') || '';
    await sendCapiEvent({
      eventName: 'Purchase',
      eventId: order.id,
      eventSourceUrl: `${origin}/order-confirmation/${order.id}`,
      userData: {
        email: body.customerEmail || undefined,
        phone: body.customerPhone,
        firstName,
        lastName,
        city: body.city,
        state: cityToDivision(body.city),
        country: 'bd',
        externalId: order.customerId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        fbc: ctx.fbc,
        fbp: ctx.fbp,
      },
      customData: {
        currency: 'BDT',
        value: total,
        content_type: 'product',
        content_ids: items.map((i: { productId: string }) => i.productId),
        contents: items.map((i: { productId: string; qty: number; price: number }) => ({ id: i.productId, quantity: i.qty, item_price: i.price })),
        num_items: items.reduce((s: number, i: { qty: number }) => s + i.qty, 0),
        order_id: String(order.orderNumber),
      },
    });

    await notifyOrderPlaced(order);

    // GA4 Measurement Protocol — server-side purchase event
    const gaCookie = req.headers.get('cookie')?.match(/_ga=([^;]+)/)?.[1];
    sendGA4Purchase({
      clientId: extractGA4ClientId(gaCookie),
      transactionId: String(order.orderNumber),
      value: total,
      shipping,
      items: items.map((i: { productId: string; name: string; price: number; qty: number }) => ({
        item_id: i.productId,
        item_name: i.name,
        price: i.price,
        quantity: i.qty,
      })),
    }).catch(console.error);

    // Create Pathao delivery order (best-effort — doesn't block the response, but
    // runs via after() so the request isn't torn down until it settles)
    after(async () => {
      try {
        const result = await createPathaoOrder({
          merchantOrderId: String(order.orderNumber),
          recipientName: order.customerName,
          recipientPhone: order.customerPhone,
          recipientAddress: `${order.shippingAddress}, ${order.city}`,
          amountToCollect: order.total,
          itemQuantity: items.reduce((s: number, i: { qty: number }) => s + i.qty, 0),
          itemWeight: 0.5,
        });
        if (result.ok) {
          await db.updateOrderPathaoConsignment(order.id, result.consignmentId, result.deliveryFee);
        } else {
          console.error('Pathao order creation failed:', result.error);
        }
      } catch (err) {
        console.error('Pathao order creation failed:', err);
      }
    });

    return NextResponse.json({ id: order.id, orderNumber: order.orderNumber });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
