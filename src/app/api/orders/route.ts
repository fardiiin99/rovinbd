import { NextResponse } from 'next/server';
import { db, DELIVERY_CHARGES, type DeliveryZone, type Order } from '@/lib/db';
import { sendCapiEvent, extractClientContext } from '@/lib/capi';
import { cityToDivision } from '@/lib/bd-divisions';
import { notifyOrderPlaced } from '@/lib/notify';
import { sendGA4Purchase, extractGA4ClientId } from '@/lib/ga4';
import { hasTrackingConsent } from '@/lib/tracking-consent';

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

    const items: Order['items'] = [];
    for (const line of body.items) {
      if (typeof line?.productId !== 'string' || !Number.isSafeInteger(line.qty) || line.qty < 1) {
        return NextResponse.json({ error: 'Invalid cart item' }, { status: 400 });
      }
      const product = await db.getProduct(line.productId);
      const variant = product?.variants.find((entry) => entry.id === line.variantId);
      if (!product || (product.variants.length > 0 && !variant) || (line.variantId && !variant)) {
        return NextResponse.json({ error: 'A cart item is no longer available' }, { status: 409 });
      }
      const existing = items.find((item) => item.productId === product.id && item.variantId === variant?.id);
      const quantity = (existing?.qty ?? 0) + line.qty;
      if (quantity > (variant?.stock ?? product.stock)) {
        return NextResponse.json({ error: 'A cart item exceeds available stock' }, { status: 409 });
      }
      if (existing) {
        existing.qty = quantity;
      } else {
        items.push({
          productId: product.id,
          name: variant ? `${product.name} — ${variant.name}` : product.name,
          price: product.price,
          qty: line.qty as number,
          image: variant?.image || product.image,
          variantId: variant?.id,
          variantName: variant?.name,
        });
      }
    }
    const subtotal = items.reduce((s: number, i: { price: number; qty: number }) => s + i.price * i.qty, 0);
    const shipping = DELIVERY_CHARGES[deliveryZone];
    const total = subtotal + shipping;
    const cookie = req.headers.get('cookie');
    const trackingConsent = hasTrackingConsent(cookie);

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
      trackingConsent,
    });

    const ctx = extractClientContext(req);
    const [firstName, ...rest] = String(body.customerName).trim().split(/\s+/);
    const lastName = rest.join(' ');
    const origin = req.headers.get('origin') || '';
    if (trackingConsent) await sendCapiEvent({
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
    const gaCookie = cookie?.match(/(?:^|;\s*)_ga=([^;]+)/)?.[1];
    if (trackingConsent && gaCookie) await sendGA4Purchase({
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

    // Pathao is booked manually from admin → Orders → "Send to Pathao".
    return NextResponse.json({ id: order.id, orderNumber: order.orderNumber });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
