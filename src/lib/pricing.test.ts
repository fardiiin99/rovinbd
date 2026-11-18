// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceCart, tierMessage, isCampaignActive, blackFridayPercent,
  dhakaInputToEpoch, epochToDhakaInput, gaItemPricing, DELIVERY_CHARGES, type BlackFridayCampaign,
} from './pricing.ts';

const units = (n: number, price = 400) => Array.from({ length: n }, () => ({ price, qty: 1 }));

test('spec totals with ৳400 items and ৳70 delivery', () => {
  const expected: Record<number, number> = { 1: 470, 2: 790, 3: 1030, 4: 1190, 5: 1070 };
  for (const [n, total] of Object.entries(expected)) {
    assert.equal(priceCart(units(Number(n)), 70, true).total, total, `${n} item(s)`);
  }
});

test('tier percentages and amounts saved', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => {
      const p = priceCart(units(n), 70, true);
      return [p.discountPercent, p.discountAmount];
    }),
    [[0, 0], [10, 80], [20, 240], [30, 480], [50, 1000]],
  );
});

test('6 or more items stay at 50%', () => {
  for (const n of [6, 7, 12]) {
    const p = priceCart(units(n), 70, true);
    assert.equal(p.discountPercent, 50);
    assert.equal(p.total, n * 400 * 0.5 + 70);
  }
  assert.equal(blackFridayPercent(100), 50);
});

test('repeated units of one product count individually', () => {
  const p = priceCart([{ price: 400, qty: 3 }], 70, true);
  assert.equal(p.itemCount, 3);
  assert.equal(p.discountPercent, 20);
  assert.equal(p.total, 1030);
});

test('mixed-price cart discounts the whole merchandise subtotal', () => {
  // scarf ৳400 x2, pant chain ৳650, durag ৳450 -> 4 items, ৳1,900 -> 30% = ৳570
  const p = priceCart([{ price: 400, qty: 2 }, { price: 650, qty: 1 }, { price: 450, qty: 1 }], 80, true);
  assert.equal(p.subtotal, 1900);
  assert.equal(p.discountPercent, 30);
  assert.equal(p.discountAmount, 570);
  assert.equal(p.total, 1900 - 570 + 80);
});

test('odd subtotals round the discount to whole taka', () => {
  const p = priceCart([{ price: 333, qty: 1 }, { price: 334, qty: 1 }], 0, true); // 667 * 10% = 66.7
  assert.equal(p.discountAmount, 67);
  assert.equal(p.total, 600);
});

test('removing an item across a tier boundary drops the tier', () => {
  const five = priceCart(units(5), 70, true);
  const four = priceCart(units(4), 70, true);
  assert.equal(five.discountPercent, 50);
  assert.equal(four.discountPercent, 30);
  assert.equal(four.total, 1190);
});

test('delivery is never discounted', () => {
  assert.equal(priceCart(units(5), 120, true).total, 1000 + 120);
  assert.equal(priceCart(units(5), 120, true).shipping, 120);
});

test('campaign off means regular prices and no message', () => {
  const p = priceCart(units(5), 70, false);
  assert.equal(p.discountPercent, 0);
  assert.equal(p.discountAmount, 0);
  assert.equal(p.discountLabel, '');
  assert.equal(p.total, 2070);
  assert.equal(p.nextTier, null);
  assert.equal(tierMessage(p, false), '');
});

test('cart message points to the next tier, then the top tier', () => {
  const msg = (n: number) => tierMessage(priceCart(units(n), 70, true), true);
  assert.equal(msg(1), 'Add 1 more item to unlock 10% off.');
  assert.equal(msg(3), 'Add 1 more item to unlock 30% off.');
  assert.equal(msg(4), 'Add 1 more item to unlock 50% off.');
  assert.equal(msg(5), 'You unlocked 50% off.');
  assert.equal(msg(9), 'You unlocked 50% off.');
  assert.equal(tierMessage(priceCart([], 70, true), true), '');
});

test('campaign window: enabled switch plus optional start and end', () => {
  const start = dhakaInputToEpoch('2026-11-28T00:00')!;
  const end = dhakaInputToEpoch('2026-11-30T23:59')!;
  const on: BlackFridayCampaign = { enabled: true, startsAt: start, endsAt: end };
  assert.equal(isCampaignActive({ ...on, enabled: false }, start + 1), false);
  assert.equal(isCampaignActive(on, start - 1), false);
  assert.equal(isCampaignActive(on, start), true);
  assert.equal(isCampaignActive(on, end - 1), true);
  assert.equal(isCampaignActive(on, end), false);
  assert.equal(isCampaignActive({ enabled: true, startsAt: null, endsAt: null }), true);
  assert.equal(isCampaignActive(null), false);
});

test('GA4 items carry the paid unit price and the unit discount', () => {
  assert.deepEqual(gaItemPricing(400, 0), { price: 400 });
  assert.deepEqual(gaItemPricing(400, 50), { price: 200, discount: 200 });
  assert.deepEqual(gaItemPricing(650, 30), { price: 455, discount: 195 });
  assert.deepEqual(gaItemPricing(333, 10), { price: 299.7, discount: 33.3 });
});

test('delivery charges are the shared ৳80 / ৳120', () => {
  assert.deepEqual(DELIVERY_CHARGES, { inside_dhaka: 80, outside_dhaka: 120 });
});

test('Dhaka time inputs convert both ways (UTC+6)', () => {
  const ms = dhakaInputToEpoch('2026-11-28T00:00')!;
  assert.equal(new Date(ms).toISOString(), '2026-11-27T18:00:00.000Z');
  assert.equal(epochToDhakaInput(ms), '2026-11-28T00:00');
  assert.equal(dhakaInputToEpoch(''), null);
  assert.equal(dhakaInputToEpoch('not a date'), null);
  assert.equal(epochToDhakaInput(null), '');
});
