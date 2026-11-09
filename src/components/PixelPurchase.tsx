'use client';
import { useEffect, useRef } from 'react';
import { gtagEvent } from '@/lib/gtag';
import { setPixelMatchData, type PixelMatchData } from '@/lib/pixel';
import { META_PIXEL_ID } from '@/lib/pixel-config';

export default function PixelPurchase({
  value,
  orderId,
  orderNumber,
  contentIds,
  numItems,
  items,
  matchData,
  currency = 'BDT',
}: {
  value: number;
  orderId: string;
  orderNumber?: number;
  contentIds?: string[];
  numItems?: number;
  items?: { id: string; name: string; price: number; qty: number; variantId?: string; variantName?: string }[];
  matchData?: PixelMatchData;
  currency?: string;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    try {
      const key = `rovin:purchase:${orderId}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      // The shared event and transaction IDs still identify the order.
    }

    // Before Purchase, so it goes out matched to the buyer, as do their later visits.
    if (matchData) setPixelMatchData(matchData, META_PIXEL_ID);

    const w = window as unknown as { fbq?: (...args: unknown[]) => void };
    if (w.fbq) {
      w.fbq(
        'track',
        'Purchase',
        {
          content_ids: contentIds ?? [],
          content_type: 'product',
          content_name: (items || []).map((it) => it.name).join(', '),
          contents: (items || []).map((it) => ({ id: it.id, quantity: it.qty, item_price: it.price })),
          num_items: numItems ?? 0,
          value,
          currency,
          order_id: orderNumber ?? orderId,
        },
        { eventID: orderId }, // dedup with Conversions API
      );
    }

    gtagEvent('purchase', {
      transaction_id: String(orderNumber ?? orderId),
      value,
      currency,
      items: (items || []).map((it) => ({
        item_id: it.id,
        item_name: it.name,
        item_variant: it.variantName,
        price: it.price,
        quantity: it.qty,
      })),
    });
  }, [value, currency, orderId, orderNumber, contentIds, numItems, items, matchData]);

  return null;
}
