// Turns a Meta ads snapshot plus the shop's own order data into a short list
// of concrete actions. Every rule is a plain threshold on numbers shown on the
// page, so a recommendation can always be checked by eye; nothing here calls
// out to a model or to Meta.
//
// The yardstick is the shop's real break-even: what one placed order is worth
// after product cost, courier fees and the share of parcels that come back.
// An ad set is "losing money" when it pays more than that per order, however
// good its Meta-reported ROAS looks.

import type { Order, Product, SiteContent } from './db';
import { computeFinance } from './finance';
import type { AdsLevel, AdsMetrics, AdsRow, AdsSnapshot } from './meta-ads';

export type Severity = 'critical' | 'warning' | 'opportunity' | 'info';
export type Verdict = 'scale' | 'keep' | 'watch' | 'cut' | 'pause' | 'learning' | 'off';

export type Recommendation = {
  id: string;
  severity: Severity;
  scope: 'account' | AdsLevel;
  entityId?: string;
  entityName?: string;
  parentName?: string;
  title: string;
  action: string;
  why: string;
  // Taka riding on the recommendation in this period; only used for ordering.
  stake: number;
};

export type StoreEconomics = {
  // Orders placed inside the reporting period.
  ordersPlaced: number;
  ordersValue: number;
  // Of those, how many arrived with a Facebook click id (the _fbc cookie).
  ordersFromAdClick: number;
  // From finalized (delivered or returned) orders in the 90 days up to the
  // end of the period.
  finalizedOrders: number;
  returnRate: number;
  aov: number;
  profitPerOrder: number;
  costsMissing: boolean;
  reliable: boolean;
};

export type Benchmarks = {
  breakEvenCpa: number | null;
  targetCpa: number | null;
  breakEvenRoas: number | null;
  basis: 'store' | 'account-average' | 'none';
};

export type Advice = {
  recommendations: Recommendation[];
  verdicts: Record<string, Verdict>;
  benchmarks: Benchmarks;
};

const MIN_FINALIZED = 15;
const DAY = 86_400_000;

export function storeEconomics(
  orders: Order[],
  products: Product[],
  content: SiteContent,
  from: number,
  to: number,
): StoreEconomics {
  const inPeriod = orders.filter((o) => o.createdAt >= from && o.createdAt <= to);
  const { summary } = computeFinance(orders, products, content, to - 90 * DAY, to);
  const finalized = summary.deliveredCount + summary.returnedCount;
  const costsMissing = summary.deliveredCount > 0 && summary.cogs === 0;
  return {
    ordersPlaced: inPeriod.length,
    ordersValue: inPeriod.reduce((s, o) => s + o.total, 0),
    ordersFromAdClick: inPeriod.filter((o) => o.trackingContext?.fbc).length,
    finalizedOrders: finalized,
    returnRate: finalized ? summary.returnedCount / finalized : 0,
    aov: summary.deliveredCount ? summary.revenue / summary.deliveredCount : 0,
    profitPerOrder: finalized ? summary.netProfit / finalized : 0,
    costsMissing,
    reliable: finalized >= MIN_FINALIZED && !costsMissing,
  };
}

const tk = (n: number) => '৳' + Math.round(n).toLocaleString('en-BD');
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const cpaOf = (m: AdsMetrics) => (m.purchases > 0 ? m.spend / m.purchases : Infinity);
const ctrOf = (m: AdsMetrics) => (m.impressions > 0 ? m.linkClicks / m.impressions : 0);
const isLive = (r: AdsRow) => !r.status || r.status === 'ACTIVE';

export function advise(snap: AdsSnapshot, econ: StoreEconomics, days: number): Advice {
  const recs: Recommendation[] = [];
  const verdicts: Record<string, Verdict> = {};
  const t = snap.totals;
  const accountCpa = cpaOf(t);
  const accountCtr = ctrOf(t);

  let basis: Benchmarks['basis'] = 'none';
  let B: number | null = null;
  if (econ.reliable && econ.profitPerOrder > 0) {
    B = econ.profitPerOrder;
    basis = 'store';
  } else if (t.purchases >= 5) {
    B = accountCpa;
    basis = 'account-average';
  }
  const target = B ? B * 0.7 : null;
  const benchmarks: Benchmarks = {
    breakEvenCpa: B,
    targetCpa: target,
    breakEvenRoas: basis === 'store' && B && econ.aov ? econ.aov / B : null,
    basis,
  };
  const yardstick = basis === 'store' ? 'your break-even cost per order' : "the account's average cost per order";

  // ---------- Account ----------
  if (t.spend === 0) {
    recs.push({
      id: 'acct-no-spend', severity: 'info', scope: 'account', stake: 0,
      title: 'No ad spend in this period',
      action: 'Nothing to optimise yet. Pick a longer range, or check in Ads Manager that a campaign is delivering.',
      why: `Meta reported ৳0 spend between ${snap.since} and ${snap.until}.`,
    });
    return { recommendations: recs, verdicts, benchmarks };
  }

  if (econ.reliable && econ.profitPerOrder <= 0) {
    recs.push({
      id: 'acct-negative-margin', severity: 'critical', scope: 'account', stake: t.spend,
      title: 'Orders lose money before ads are even counted',
      action: 'Fix margin first: raise the price or bundle, cut the return rate, or lower delivery cost. No ad budget can be profitable until an average order is.',
      why: `Over the last 90 days an average finalized order made ${tk(econ.profitPerOrder)} after product cost, courier fees and returns (${pct(econ.returnRate)} of parcels came back).`,
    });
  }

  if (basis === 'store' && B && t.purchases >= 5 && accountCpa > B) {
    recs.push({
      id: 'acct-unprofitable', severity: 'critical', scope: 'account', stake: (accountCpa - B) * t.purchases,
      title: 'The account as a whole is paying more per order than an order earns',
      action: `Bring the average cost per order under ${tk(B)}: act on the pause and cut items below before adding any budget.`,
      why: `Cost per order is ${tk(accountCpa)} against a break-even of ${tk(B)}, a loss of about ${tk((accountCpa - B) * t.purchases)} across ${t.purchases} orders in this period.`,
    });
  }

  const p = snap.prevTotals;
  if (t.purchases >= 5 && p.purchases >= 5) {
    const change = accountCpa / cpaOf(p) - 1;
    if (change >= 0.25) {
      recs.push({
        id: 'acct-cpa-up', severity: 'warning', scope: 'account', stake: (accountCpa - cpaOf(p)) * t.purchases,
        title: `Cost per order is up ${pct(change)} on the previous period`,
        action: 'Look at the ad-level items below first: rising cost across the board usually means the main creative is wearing out or a recent edit reset learning.',
        why: `${tk(cpaOf(p))} per order in ${snap.prevSince} to ${snap.prevUntil}, ${tk(accountCpa)} now.`,
      });
    } else if (change <= -0.2) {
      recs.push({
        id: 'acct-cpa-down', severity: 'info', scope: 'account', stake: 0,
        title: `Cost per order improved ${pct(-change)} on the previous period`,
        action: 'Leave the winning ad sets alone: avoid edits that restart the learning phase while this holds.',
        why: `${tk(cpaOf(p))} per order before, ${tk(accountCpa)} now.`,
      });
    }
  }

  // Funnel: where do paid clicks drop out?
  if (t.linkClicks >= 200 && t.landingPageViews > 0 && t.landingPageViews / t.linkClicks < 0.6) {
    const rate = t.landingPageViews / t.linkClicks;
    recs.push({
      id: 'funnel-lpv', severity: 'warning', scope: 'account', stake: t.spend * (0.75 - rate),
      title: `Only ${pct(rate)} of ad clicks wait for the page to load`,
      action: 'Speed up the landing page on mobile data (image weight, first paint) and send clicks to the product page rather than the home page. Also check placements: Audience Network clicks are often accidental.',
      why: `${t.linkClicks.toLocaleString()} link clicks but ${t.landingPageViews.toLocaleString()} landing page views. A healthy store keeps 75% or more.`,
    });
  }
  if (t.landingPageViews >= 300 && t.addToCart / t.landingPageViews < 0.04) {
    recs.push({
      id: 'funnel-atc', severity: 'warning', scope: 'account', stake: 0,
      title: `Only ${pct(t.addToCart / t.landingPageViews)} of visitors add to cart`,
      action: 'The click is cheap but the page is not convincing: show price and delivery charge up front, lead with a worn/in-use photo, and make sure the ad promise matches the first screen.',
      why: `${t.landingPageViews.toLocaleString()} landing page views led to ${t.addToCart.toLocaleString()} add-to-carts.`,
    });
  }
  if (t.initiateCheckout >= 30 && t.purchases / t.initiateCheckout < 0.35) {
    recs.push({
      id: 'funnel-checkout', severity: 'warning', scope: 'account', stake: 0,
      title: `Only ${pct(t.purchases / t.initiateCheckout)} of started checkouts become orders`,
      action: 'Shorten the checkout: fewer required fields, delivery charge visible before the form, and a retargeting ad set for people who started checkout in the last 7 days.',
      why: `${t.initiateCheckout} checkouts started, ${t.purchases} purchases recorded.`,
    });
  }

  // Tracking sanity: Meta cannot have driven more orders than the shop received.
  if (t.purchases >= 5 && t.purchases > econ.ordersPlaced * 1.15) {
    recs.push({
      id: 'tracking-over', severity: 'warning', scope: 'account', stake: t.spend,
      title: 'Meta is counting more purchases than the store received',
      action: 'Check Events Manager for duplicate Purchase events (pixel and Conversions API must share an event ID). Until fixed, every cost-per-order figure here is flattering.',
      why: `Meta reports ${t.purchases} purchases; the store has ${econ.ordersPlaced} orders for ${snap.since} to ${snap.until}.`,
    });
  } else if (econ.ordersFromAdClick >= 5 && t.purchases < econ.ordersFromAdClick * 0.6) {
    recs.push({
      id: 'tracking-under', severity: 'info', scope: 'account', stake: 0,
      title: 'Meta is under-reporting purchases',
      action: 'Ads are doing better than Ads Manager shows, so do not pause on Meta numbers alone. Check that the Purchase event reaches Meta from the server (Conversions API) for every order.',
      why: `${econ.ordersFromAdClick} store orders arrived from a Facebook ad click, but Meta attributes only ${t.purchases}.`,
    });
  }

  if (econ.finalizedOrders >= MIN_FINALIZED && econ.returnRate >= 0.2 && B && basis === 'store') {
    recs.push({
      id: 'returns', severity: 'warning', scope: 'account', stake: 0,
      title: `${pct(econ.returnRate)} of parcels come back`,
      action: 'Confirm cash-on-delivery orders by phone or SMS before dispatch, and exclude the districts with the worst return rates from targeting. Every point of return rate you remove raises what you can afford to pay per order.',
      why: `${Math.round(econ.returnRate * econ.finalizedOrders)} of the last ${econ.finalizedOrders} finalized orders were returned. That is already priced into the ${tk(B)} break-even.`,
    });
  }

  if (!econ.reliable) {
    recs.push({
      id: 'econ-missing', severity: 'info', scope: 'account', stake: 0,
      title: 'Break-even is estimated, not measured',
      action: econ.costsMissing
        ? 'Set a cost on each product (Products page) so profit per order, and therefore the pause/scale thresholds, use real margins.'
        : `Recommendations compare ad sets with each other until ${MIN_FINALIZED} orders have been delivered or returned.`,
      why: econ.costsMissing
        ? 'Delivered orders show no product cost, so true profit per order is unknown.'
        : `${econ.finalizedOrders} finalized orders in the last 90 days.`,
    });
  }

  // ---------- Ad sets: where the budget decisions are ----------
  const liveSets = snap.adsets.filter(isLive);
  for (const s of snap.adsets) {
    if (!isLive(s)) { verdicts[s.id] = 'off'; continue; }
    verdicts[s.id] = 'keep';
    if (!B || !target) continue;
    const cpa = cpaOf(s);
    const budgetNote = s.dailyBudget
      ? ` (daily budget ${tk(s.dailyBudget)})`
      : ` (its budget is set on the campaign "${s.campaignName}")`;
    const base = { scope: 'adset' as const, entityId: s.id, entityName: s.name, parentName: s.campaignName };

    if (s.purchases === 0 && s.spend >= 2 * B) {
      verdicts[s.id] = 'pause';
      recs.push({
        ...base, id: `set-pause-${s.id}`, severity: 'critical', stake: s.spend,
        title: 'Pause this ad set',
        action: `Turn it off. If you still believe in the audience, relaunch it with a different creative rather than letting this one keep spending${budgetNote}.`,
        why: `Spent ${tk(s.spend)} with no purchases, ${(s.spend / B).toFixed(1)}× ${yardstick} (${tk(B)}).`,
      });
    } else if (s.spend >= 2 * B && cpa > 1.3 * B) {
      verdicts[s.id] = 'pause';
      recs.push({
        ...base, id: `set-pause-${s.id}`, severity: 'critical', stake: (cpa - B) * s.purchases,
        title: 'Pause this ad set or halve its budget',
        action: `${basis === 'store' ? 'Each order from here costs more than it earns' : 'It is far more expensive than your other ad sets'}. Pause it, or cut the budget by 50% and keep only its best ad${budgetNote}.`,
        why: `${tk(cpa)} per order over ${s.purchases} orders against ${yardstick} of ${tk(B)}${basis === 'store' ? `: about ${tk((cpa - B) * s.purchases)} lost in this period` : ''}.`,
      });
    } else if (s.spend >= 1.5 * B && cpa > B) {
      verdicts[s.id] = 'cut';
      recs.push({
        ...base, id: `set-cut-${s.id}`, severity: 'warning', stake: (cpa - B) * s.purchases,
        title: 'Cut this ad set by 20–30%',
        action: s.dailyBudget
          ? `Lower the daily budget from ${tk(s.dailyBudget)} to about ${tk(s.dailyBudget * 0.75)} and re-check in 3 days.`
          : `Its budget is set on the campaign "${s.campaignName}": lower that by 20–30%, or set a spend cap on this ad set, and re-check in 3 days.`,
        why: `${tk(cpa)} per order over ${s.purchases} orders, above ${yardstick} of ${tk(B)}.`,
      });
    } else if (s.purchases >= 5 && cpa <= target) {
      if (s.frequency >= 3) {
        verdicts[s.id] = 'watch';
        recs.push({
          ...base, id: `set-saturated-${s.id}`, severity: 'opportunity', stake: (B - cpa) * s.purchases,
          title: 'Profitable but the audience is saturating',
          action: 'Do not raise this budget. Duplicate the ad set to a fresh audience (broad or a new lookalike) and add 1–2 new creatives here.',
          why: `${tk(cpa)} per order over ${s.purchases} orders, but people have seen it ${s.frequency.toFixed(1)} times on average.`,
        });
      } else {
        verdicts[s.id] = 'scale';
        recs.push({
          ...base, id: `set-scale-${s.id}`, severity: 'opportunity', stake: (B - cpa) * s.purchases,
          title: 'Raise this budget by 20%',
          action: s.dailyBudget
            ? `Increase the daily budget from ${tk(s.dailyBudget)} to ${tk(s.dailyBudget * 1.2)}. Repeat every 3 days while cost per order stays under ${tk(target)}; bigger jumps restart learning.`
            : `Its budget is set on the campaign "${s.campaignName}": raise that by 20%, and repeat every 3 days while cost per order stays under ${tk(target)}.`,
          why: `${tk(cpa)} per order over ${s.purchases} orders, well under ${yardstick} of ${tk(B)}, with frequency still at ${s.frequency.toFixed(1)}.`,
        });
      }
    } else if (s.purchases > 0 && cpa > target && cpa <= B) {
      verdicts[s.id] = 'watch';
    } else if (s.learning === 'LEARNING') {
      verdicts[s.id] = 'learning';
    }
  }

  // Too many ad sets each starved of conversions never leave the learning phase.
  const spending = liveSets.filter((s) => s.spend > 0);
  const weekly = (t.purchases / Math.max(days, 1)) * 7;
  const limited = spending.filter((s) => s.learning === 'FAIL');
  if (spending.length >= 4 && weekly / spending.length < 10) {
    recs.push({
      id: 'fragmented', severity: 'warning', scope: 'account', stake: 0,
      title: `Budget is spread over ${spending.length} ad sets`,
      action: `Merge into ${Math.max(1, Math.round(weekly / 25))}–${Math.max(2, Math.round(weekly / 12))} ad sets (keep the ones marked Scale or Keep) so each gets enough orders for Meta to optimise.`,
      why: `About ${Math.round(weekly)} orders a week across ${spending.length} ad sets is ${(weekly / spending.length).toFixed(1)} each; delivery stabilises nearer 50 a week per ad set.${limited.length ? ` Meta already marks ${limited.length} of them "Learning limited".` : ''}`,
    });
  }

  // ---------- Ads: creative decisions ----------
  const liveSetIds = new Set(liveSets.map((s) => s.id));
  const liveAdIds = new Set(
    snap.ads.filter((a) => isLive(a) && (!a.adsetId || liveSetIds.has(a.adsetId))).map((a) => a.id),
  );
  const siblings = new Map<string, number>();
  for (const a of snap.ads) {
    if (liveAdIds.has(a.id) && a.adsetId) siblings.set(a.adsetId, (siblings.get(a.adsetId) || 0) + 1);
  }

  for (const a of snap.ads) {
    if (!liveAdIds.has(a.id)) { verdicts[a.id] = 'off'; continue; }
    verdicts[a.id] = 'keep';
    const base = { scope: 'ad' as const, entityId: a.id, entityName: a.name, parentName: a.adsetName };
    const cpa = cpaOf(a);
    const ctr = ctrOf(a);
    const prev = snap.prevAds[a.id];
    // The ad set recommendation already covers these; don't repeat it per ad.
    if (a.adsetId && verdicts[a.adsetId] === 'pause') { verdicts[a.id] = 'pause'; continue; }

    // Losing ads inside an ad set that is otherwise worth keeping.
    if (B && (siblings.get(a.adsetId || '') || 0) >= 2) {
      if ((a.purchases === 0 && a.spend >= 1.5 * B) || (a.spend >= 2 * B && cpa > 1.3 * B)) {
        verdicts[a.id] = 'pause';
        recs.push({
          ...base, id: `ad-off-${a.id}`, severity: 'warning', stake: a.purchases ? (cpa - B) * a.purchases : a.spend,
          title: 'Turn off this ad',
          action: 'Switch it off so its share of the budget moves to the better ads in the same ad set.',
          why: a.purchases === 0
            ? `Spent ${tk(a.spend)} with no purchases.`
            : `${tk(cpa)} per order over ${a.purchases} orders against ${yardstick} of ${tk(B)}.`,
        });
        continue;
      }
    }

    if (a.frequency >= 3 && a.impressions >= 3000 && prev && prev.impressions >= 2000 && ctrOf(prev) > 0) {
      const drop = 1 - ctr / ctrOf(prev);
      if (drop >= 0.25) {
        verdicts[a.id] = 'watch';
        recs.push({
          ...base, id: `ad-fatigue-${a.id}`, severity: 'warning', stake: a.spend * drop,
          title: 'This creative is wearing out',
          action: 'Launch 2–3 new versions in the same ad set (new first 3 seconds, new opening image, same offer) and let this one fade instead of editing it.',
          why: `Click-through fell ${pct(drop)} (${pct(ctrOf(prev))} to ${pct(ctr)}) while frequency reached ${a.frequency.toFixed(1)}.`,
        });
        continue;
      }
    }

    if (a.impressions >= 3000 && ctr < 0.007 && ctr < accountCtr * 0.6 && a.purchases < 3) {
      verdicts[a.id] = 'watch';
      recs.push({
        ...base, id: `ad-ctr-${a.id}`, severity: 'warning', stake: a.spend,
        title: 'Weak hook: people scroll past this ad',
        action: 'Replace the opening frame and first line. Show the product being worn in the first second and put the price or offer in the headline.',
        why: `Link click-through is ${pct(ctr)} over ${a.impressions.toLocaleString()} impressions; the account averages ${pct(accountCtr)}.`,
      });
      continue;
    }

    if (target && a.purchases >= 3 && cpa <= target) verdicts[a.id] = 'scale';
  }

  if (B && target && liveAdIds.size >= 2) {
    const best = snap.ads
      .filter((a) => verdicts[a.id] === 'scale')
      .sort((x, y) => cpaOf(x) - cpaOf(y))[0];
    if (best) {
      recs.push({
        id: `ad-best-${best.id}`, severity: 'opportunity', scope: 'ad', stake: (B - cpaOf(best)) * best.purchases,
        entityId: best.id, entityName: best.name, parentName: best.adsetName,
        title: 'Your best ad: make more like it',
        action: 'Brief 3 variations on this one (same angle, different opening shot, colourway or model) and add them to your scaling ad set. Winners fade; have the next one ready.',
        why: `${tk(cpaOf(best))} per order over ${best.purchases} orders, the lowest of any live ad.`,
      });
    }
  }

  // ---------- Campaigns: verdict only, the money moves are on ad sets ----------
  for (const c of snap.campaigns) {
    if (!isLive(c)) { verdicts[c.id] = 'off'; continue; }
    const cpa = cpaOf(c);
    if (!B || !target) verdicts[c.id] = 'keep';
    else if (c.spend >= 2 * B && (c.purchases === 0 || cpa > 1.3 * B)) verdicts[c.id] = 'pause';
    else if (c.spend >= 1.5 * B && cpa > B) verdicts[c.id] = 'cut';
    else if (c.purchases >= 5 && cpa <= target) verdicts[c.id] = 'scale';
    else if (c.purchases > 0 && cpa > target) verdicts[c.id] = 'watch';
    else verdicts[c.id] = 'keep';
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  recs.sort((a, b) => order[a.severity] - order[b.severity] || b.stake - a.stake);
  return { recommendations: recs, verdicts, benchmarks };
}
