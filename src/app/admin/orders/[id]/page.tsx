import { db } from '@/lib/db';
import { formatPrice, formatDate } from '@/lib/format';
import { notFound } from 'next/navigation';
import StatusSelect from './StatusSelect';
import DeleteOrderButton from './DeleteOrderButton';

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await db.getOrder(id);
  if (!o) notFound();

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Order <span className="text-brand-600">#{o.orderNumber}</span></h1>
      <p className="text-stone-600 mt-1">Placed {formatDate(o.createdAt)}</p>

      <div className="mt-6 grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 card p-5">
          <h2 className="font-semibold">Items</h2>
          <div className="mt-3 divide-y divide-stone-100">
            {o.items.map((it, idx) => (
              <div key={`${it.productId}::${it.variantId || ''}::${idx}`} className="py-3 flex gap-3 items-center">
                <div className="w-12 h-12 rounded bg-stone-100 overflow-hidden"><img src={it.image} alt="" className="w-full h-full object-cover" /></div>
                <div className="flex-1"><div className="font-medium">{it.name}</div><div className="text-sm text-stone-600">Qty {it.qty} × {formatPrice(it.price)}</div></div>
                <div className="font-semibold">{formatPrice(it.price * it.qty)}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-stone-200 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatPrice(o.subtotal)}</span></div>
            {o.discountAmount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>{o.discountLabel || 'Discount'} ({o.discountPercent}%)</span>
                <span>−{formatPrice(o.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between"><span>Delivery ({o.deliveryZone === 'outside_dhaka' ? 'Outside Dhaka' : 'Inside Dhaka'})</span><span>{formatPrice(o.shipping)}</span></div>
            <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{formatPrice(o.total)}</span></div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="font-semibold">Status</h2>
            <StatusSelect orderId={o.id} status={o.status} />
          </div>
          <div className="card p-5">
            <h2 className="font-semibold mb-3">Danger zone</h2>
            <DeleteOrderButton orderId={o.id} orderNumber={o.orderNumber} />
          </div>
          <div className="card p-5 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <div className="mt-2 space-y-1">
              <div>{o.customerName}</div>
              <div className="text-stone-600">{o.customerEmail}</div>
              <div className="text-stone-600">{o.customerPhone}</div>
            </div>
          </div>
          <div className="card p-5 text-sm">
            <h2 className="font-semibold">Shipping</h2>
            <div className="mt-2 text-stone-700">
              <div>{o.shippingAddress}</div>
              <div>{o.city}</div>
            </div>
          </div>
          <div className="card p-5 text-sm">
            <h2 className="font-semibold">Payment & Delivery</h2>
            <div className="mt-2 text-stone-700">Cash on Delivery</div>
            <div className="text-stone-600">{o.deliveryZone === 'outside_dhaka' ? 'Outside Dhaka' : 'Inside Dhaka'} — {formatPrice(o.shipping)}</div>
            {o.pathaoConsignmentId && (
              <div className="mt-2 text-xs font-mono text-brand-600 bg-brand-50 px-2 py-1 rounded">
                Pathao: {o.pathaoConsignmentId}
              </div>
            )}
          </div>
          {o.notes && (
            <div className="card p-5 text-sm">
              <h2 className="font-semibold">Notes</h2>
              <div className="mt-2 text-stone-700 whitespace-pre-wrap">{o.notes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
