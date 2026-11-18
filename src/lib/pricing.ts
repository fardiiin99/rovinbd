// Shared order pricing: the cart, the checkout summary and the order API all
// call priceCart(), so the shopper sees exactly what the server charges.
// Pure and dependency-free so it runs in the browser and on the server alike.

// Delivery charges by zone (Bangladeshi Taka). Never discounted.
export const DELIVERY_CHARGES = {
  inside_dhaka: 80,
  outside_dhaka: 120,
} as const;
export type DeliveryZone = keyof typeof DELIVERY_CHARGES;

export type BlackFridayCampaign = {
  enabled: boolean;
  startsAt: number | null; // epoch ms; null = no start limit
  endsAt: number | null; // epoch ms; null = no end limit
};

// Highest tier first. The discount applies to the whole merchandise subtotal.
export const BLACK_FRIDAY_TIERS = [
  { minItems: 5, percent: 50 },
  { minItems: 4, percent: 30 },
  { minItems: 3, percent: 20 },
  { minItems: 2, percent: 10 },
] as const;

export const BLACK_FRIDAY_MAX_PERCENT = BLACK_FRIDAY_TIERS[0].percent;
export const BLACK_FRIDAY_LABEL = 'Black Friday discount';

export function isCampaignActive(campaign: BlackFridayCampaign | null | undefined, now: number = Date.now()): boolean {
  if (!campaign?.enabled) return false;
  if (campaign.startsAt != null && now < campaign.startsAt) return false;
  if (campaign.endsAt != null && now >= campaign.endsAt) return false;
  return true;
}

export function blackFridayPercent(itemCount: number): number {
  return BLACK_FRIDAY_TIERS.find((t) => itemCount >= t.minItems)?.percent ?? 0;
}

export type PricedLine = { price: number; qty: number };

export type PricedCart = {
  itemCount: number;
  subtotal: number; // merchandise before discount
  discountPercent: number;
  discountAmount: number;
  discountLabel: string; // '' when no offer applies
  shipping: number;
  total: number; // subtotal - discountAmount + shipping
  // The next tier the shopper can reach, or null at the top tier / when off.
  nextTier: { itemsNeeded: number; percent: number } | null;
};

export function priceCart(lines: PricedLine[], shipping: number, campaignActive: boolean): PricedCart {
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discountPercent = campaignActive ? blackFridayPercent(itemCount) : 0;
  // Whole taka, since prices and COD collection are in whole taka.
  const discountAmount = Math.round((subtotal * discountPercent) / 100);
  const next = campaignActive
    ? [...BLACK_FRIDAY_TIERS].reverse().find((t) => t.minItems > itemCount)
    : undefined;
  return {
    itemCount,
    subtotal,
    discountPercent,
    discountAmount,
    discountLabel: discountPercent > 0 ? BLACK_FRIDAY_LABEL : '',
    shipping,
    total: subtotal - discountAmount + shipping,
    nextTier: next ? { itemsNeeded: next.minItems - itemCount, percent: next.percent } : null,
  };
}

// GA4 item convention: `price` is the unit price actually paid and `discount`
// the unit amount taken off, so item revenue reflects the sale. Two decimals
// because the order-level discount is spread across every unit.
export function gaItemPricing(price: number, discountPercent: number): { price: number; discount?: number } {
  if (!discountPercent) return { price };
  const discount = Math.round(price * discountPercent) / 100;
  return { price: Math.round((price - discount) * 100) / 100, discount };
}

// The one short cart message: what the next item unlocks, or that the top
// tier is reached. Empty when the sale is off or the cart is empty.
export function tierMessage(priced: PricedCart, campaignActive: boolean): string {
  if (!campaignActive || priced.itemCount === 0) return '';
  if (!priced.nextTier) return `You unlocked ${BLACK_FRIDAY_MAX_PERCENT}% off.`;
  const { itemsNeeded, percent } = priced.nextTier;
  return `Add ${itemsNeeded} more item${itemsNeeded === 1 ? '' : 's'} to unlock ${percent}% off.`;
}

// Campaign times are entered and shown in Bangladesh time (UTC+6, no DST),
// whatever the admin's own device timezone is.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// "2026-11-28T00:00" (Dhaka wall clock) -> epoch ms; '' or invalid -> null.
export function dhakaInputToEpoch(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - DHAKA_OFFSET_MS;
}

// epoch ms -> "2026-11-28T00:00" in Dhaka time, for <input type="datetime-local">.
export function epochToDhakaInput(ms: number | null): string {
  if (ms == null) return '';
  return new Date(ms + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}
