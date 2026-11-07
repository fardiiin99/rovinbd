import { db } from '@/lib/db';
import StoreHeader from '@/components/StoreHeader';
import StoreFooter from '@/components/StoreFooter';
import { formatPrice, formatDate } from '@/lib/format';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import PixelPurchase from '@/components/PixelPurchase';

export default async function OrderConfirmation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const content = await db.getContent();
  const order = await db.getOrder(id);
  if (!order) notFound();

  return (
    <>
      <StoreHeader siteName={content.siteName} />
      {order.trackingConsent && <PixelPurchase
        value={order.total}
        orderId={order.id}
        orderNumber={order.orderNumber}
        contentIds={order.items.map((it) => it.productId)}
        numItems={order.items.reduce((s, it) => s + it.qty, 0)}
        items={order.items.map((it) => ({
          id: it.productId, name: it.name, price: it.price, qty: it.qty,
          variantId: it.variantId, variantName: it.variantName,
        }))}
        currency="BDT"
      />}
      <main className="flex-1 max-w-3xl mx-auto px-4 py-12 w-full">
        <div className="card p-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-3xl">✓</div>
          <h1 className="font-display text-3xl font-bold mt-4">Thank you for your order!</h1>
          <p className="text-stone-600 mt-2">We've received your order and will contact you shortly.</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-brand-50 border border-brand-200 text-brand-700 rounded-xl px-5 py-3">
            <span className="text-sm font-medium">Order Number</span>
            <span className="font-display text-2xl font-bold">#{order.orderNumber}</span>
          </div>
        </div>

        <div className="card p-6 mt-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Order Details</h2>
            <span className="text-sm font-medium text-stone-500">#{order.orderNumber}</span>
          </div>
          <div className="text-sm text-stone-600 mt-1">Placed {formatDate(order.createdAt)}</div>
          <div className="mt-4 divide-y divide-stone-100">
            {order.items.map((it, idx) => (
              <div key={`${it.productId}::${it.variantId || ''}::${idx}`} className="py-3 flex gap-3 items-center">
                <div className="w-14 h-14 rounded bg-stone-100 overflow-hidden"><img src={it.image} alt={it.name} className="w-full h-full object-cover" /></div>
                <div className="flex-1"><div className="font-medium">{it.name}</div><div className="text-sm text-stone-600">Qty {it.qty} × {formatPrice(it.price)}</div></div>
                <div className="font-semibold">{formatPrice(it.price * it.qty)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-stone-200 grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-semibold mb-1">Shipping to</div>
              <div>{order.customerName}</div>
              <div className="text-stone-600">{order.shippingAddress}</div>
              <div className="text-stone-600">{order.city}</div>
              <div className="text-stone-600">{order.customerPhone}</div>
            </div>
            <div>
              <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
              <div className="flex justify-between"><span>Delivery ({order.deliveryZone === 'outside_dhaka' ? 'Outside Dhaka' : 'Inside Dhaka'})</span><span>{formatPrice(order.shipping)}</span></div>
              <div className="flex justify-between font-semibold text-base mt-1 pt-1 border-t border-stone-200"><span>Total</span><span>{formatPrice(order.total)}</span></div>
              <div className="text-stone-600 mt-2">Payment: Cash on Delivery</div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/shop" className="btn btn-outline">Continue Shopping</Link>
        </div>
      </main>
      <StoreFooter siteName={content.siteName} email={content.contactEmail} phone={content.contactPhone} address={content.contactAddress} />
    </>
  );
}
