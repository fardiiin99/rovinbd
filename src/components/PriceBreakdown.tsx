import { formatPrice } from '@/lib/format';
import type { PricedCart } from '@/lib/pricing';

// Summary rows shared by the cart and checkout: merchandise subtotal, the
// Black Friday discount and amount saved, delivery, and the final total.
export default function PriceBreakdown({
  priced,
  deliveryLabel,
  deliveryNote,
}: {
  priced: PricedCart;
  deliveryLabel: string;
  deliveryNote?: string;
}) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex justify-between">
        <span>Subtotal ({priced.itemCount} item{priced.itemCount === 1 ? '' : 's'})</span>
        <span>{formatPrice(priced.subtotal)}</span>
      </div>
      {priced.discountAmount > 0 && (
        <div className="flex justify-between text-green-700 font-medium">
          <span>{priced.discountLabel} ({priced.discountPercent}%)</span>
          <span>−{formatPrice(priced.discountAmount)}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>{deliveryLabel}</span>
        <span>{formatPrice(priced.shipping)}</span>
      </div>
      {deliveryNote && <div className="text-xs text-stone-500">{deliveryNote}</div>}
      <div className="flex justify-between font-semibold text-base pt-2 border-t border-stone-200">
        <span>Total</span>
        <span>{formatPrice(priced.total)}</span>
      </div>
      {priced.discountAmount > 0 && (
        <div className="text-right text-green-700 text-sm">You save {formatPrice(priced.discountAmount)}</div>
      )}
    </div>
  );
}
