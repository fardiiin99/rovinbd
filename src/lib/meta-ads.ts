// Read-only client for the Meta Marketing API (Insights + entity status).
//
// Needs a token with the `ads_read` permission. The Conversions API token the
// pixel uses is usually scoped to the pixel only, so META_ADS_ACCESS_TOKEN is
// tried first and the CAPI token is only a fallback for setups where one
// system-user token carries both permissions.
//
// Nothing here writes to the ad account: budgets and statuses are only read.

const API_VERSION = process.env.META_API_VERSION || 'v25.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export type AdsLevel = 'campaign' | 'adset' | 'ad';

export type AdsMetrics = {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  linkClicks: number;
  landingPageViews: number;
  viewContent: number;
  addToCart: number;
  initiateCheckout: number;
  purchases: number;
  purchaseValue: number;
};

export type AdsRow = AdsMetrics & {
  level: AdsLevel;
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  adsetId?: string;
  adsetName?: string;
  // From the entity itself rather than Insights; undefined when the lookup failed.
  status?: string;
  // Undefined for ad sets funded by a campaign budget (and for ads).
  dailyBudget?: number;
  learning?: string;
};

export type AdsDay = AdsMetrics & { date: string };

export type AdsAccount = {
  id: string; // without the act_ prefix
  name: string;
  currency: string;
  timezone: string;
  fx: number;
};

export type AdsSnapshot = {
  account: AdsAccount;
  since: string;
  until: string;
  prevSince: string;
  prevUntil: string;
  totals: AdsMetrics;
  prevTotals: AdsMetrics;
  campaigns: AdsRow[];
  adsets: AdsRow[];
  ads: AdsRow[];
  // Ad-level rows for the comparison period, keyed by ad id.
  prevAds: Record<string, AdsMetrics>;
  daily: AdsDay[];
  fetchedAt: number;
};

export class MetaAdsError extends Error {
  constructor(
    message: string,
    public kind: 'not_configured' | 'permission' | 'pick_account' | 'api',
    public accounts?: { id: string; name: string }[],
  ) {
    super(message);
  }
}

function token(): string {
  return (process.env.META_ADS_ACCESS_TOKEN || process.env.META_CAPI_ACCESS_TOKEN || '').trim();
}

export function adsTokenSource(): 'META_ADS_ACCESS_TOKEN' | 'META_CAPI_ACCESS_TOKEN' | null {
  if ((process.env.META_ADS_ACCESS_TOKEN || '').trim()) return 'META_ADS_ACCESS_TOKEN';
  if ((process.env.META_CAPI_ACCESS_TOKEN || '').trim()) return 'META_CAPI_ACCESS_TOKEN';
  return null;
}

type GraphError = { message?: string; code?: number; type?: string };

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // The token goes in a header so it never lands in a logged URL.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { error?: GraphError };
  if (!res.ok || body.error) {
    const e = body.error || {};
    const msg = e.message || `Meta API returned HTTP ${res.status}`;
    // 190 = bad/expired token, 200 and 10 = missing permission; a code-100
    // "missing permissions" message means the token cannot see the object.
    const permission = e.code === 190 || e.code === 200 || e.code === 10 || /permission/i.test(msg);
    throw new MetaAdsError(msg, permission ? 'permission' : 'api');
  }
  return body as T;
}

type Paged<T> = { data: T[]; paging?: { next?: string } };

async function graphAll<T>(path: string, params: Record<string, string>, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<Paged<T>>(path, params);
  out.push(...(page.data || []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graph<Paged<T>>(page.paging.next);
    out.push(...(page.data || []));
  }
  return out;
}

async function resolveAccountId(): Promise<string> {
  const configured = (process.env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '');
  if (configured) return configured;
  const accounts = await graphAll<{ account_id: string; name: string }>('me/adaccounts', {
    fields: 'account_id,name',
    limit: '50',
  });
  if (accounts.length === 1) return accounts[0].account_id;
  if (accounts.length === 0) {
    throw new MetaAdsError('This token cannot see any ad account.', 'permission');
  }
  throw new MetaAdsError(
    'This token can see more than one ad account. Set META_AD_ACCOUNT_ID to the one to report on.',
    'pick_account',
    accounts.map((a) => ({ id: a.account_id, name: a.name })),
  );
}

type RawAction = { action_type: string; value: string };
type RawInsight = {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: RawAction[];
  action_values?: RawAction[];
};

// Meta reports the same conversion under several action types (the pixel one,
// the "omni" roll-up, the generic one). Take the first that is present rather
// than adding them, which would count every purchase two or three times.
function pick(actions: RawAction[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const ATC = ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'];
const IC = ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'];
const VC = ['omni_view_content', 'view_content', 'offsite_conversion.fb_pixel_view_content'];
const LPV = ['omni_landing_page_view', 'landing_page_view'];

function toMetrics(r: RawInsight, fx: number): AdsMetrics {
  return {
    spend: (Number(r.spend) || 0) * fx,
    impressions: Number(r.impressions) || 0,
    reach: Number(r.reach) || 0,
    frequency: Number(r.frequency) || 0,
    linkClicks: Number(r.inline_link_clicks) || 0,
    landingPageViews: pick(r.actions, LPV),
    viewContent: pick(r.actions, VC),
    addToCart: pick(r.actions, ATC),
    initiateCheckout: pick(r.actions, IC),
    purchases: pick(r.actions, PURCHASE),
    purchaseValue: pick(r.action_values, PURCHASE) * fx,
  };
}

export const ZERO: AdsMetrics = {
  spend: 0, impressions: 0, reach: 0, frequency: 0, linkClicks: 0, landingPageViews: 0,
  viewContent: 0, addToCart: 0, initiateCheckout: 0, purchases: 0, purchaseValue: 0,
};

const BASE_FIELDS = 'spend,impressions,reach,frequency,inline_link_clicks,actions,action_values';
const ID_FIELDS: Record<AdsLevel, string> = {
  campaign: 'campaign_id,campaign_name',
  adset: 'campaign_id,campaign_name,adset_id,adset_name',
  ad: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
};

function insights(accountId: string, level: AdsLevel | 'account', since: string, until: string, daily = false) {
  const params: Record<string, string> = {
    level,
    fields: level === 'account' ? BASE_FIELDS : `${ID_FIELDS[level]},${BASE_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
    limit: '500',
  };
  if (daily) params.time_increment = '1';
  return graphAll<RawInsight>(`act_${accountId}/insights`, params);
}

type RawEntity = {
  id: string;
  effective_status?: string;
  daily_budget?: string;
  learning_stage_info?: { status?: string };
};

// Status and budget are a nice-to-have on top of the numbers, so a failure
// here (a field Meta has renamed, a rate limit) degrades to "unknown" instead
// of taking the whole report down.
async function entities(accountId: string, edge: 'campaigns' | 'adsets' | 'ads', fields: string): Promise<Map<string, RawEntity>> {
  try {
    const rows = await graphAll<RawEntity>(`act_${accountId}/${edge}`, { fields, limit: '500' }, 4);
    return new Map(rows.map((r) => [r.id, r]));
  } catch (err) {
    console.warn(`Meta ads: could not read ${edge} (${(err as Error).message})`);
    return new Map();
  }
}

// Dates are handled as YYYY-MM-DD strings in Dhaka time: the shop's orders are
// bucketed the same way, so "yesterday" means the same day on both sides.
export function dhakaDate(offsetDays = 0, from = Date.now()): string {
  const d = new Date(from + 6 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function dhakaDayBounds(since: string, until: string): { from: number; to: number } {
  return {
    from: Date.parse(`${since}T00:00:00+06:00`),
    to: Date.parse(`${until}T23:59:59.999+06:00`),
  };
}

export function resolveRange(days: number): { since: string; until: string; prevSince: string; prevUntil: string } {
  // "Today" is the only range that includes the unfinished day; the others end
  // yesterday so a half-reported day cannot drag the averages down.
  if (days <= 1) {
    return { since: dhakaDate(0), until: dhakaDate(0), prevSince: dhakaDate(-1), prevUntil: dhakaDate(-1) };
  }
  return {
    since: dhakaDate(-days),
    until: dhakaDate(-1),
    prevSince: dhakaDate(-2 * days),
    prevUntil: dhakaDate(-days - 1),
  };
}

// Used only until the admin types the rate they actually pay. Card payments
// and agency top-ups in Bangladesh land well above the interbank rate, so this
// is an env setting and a visible field on the page, not a fact.
export function defaultFx(currency: string): number {
  if (currency === 'BDT') return 1;
  const fromEnv = Number(process.env.META_ADS_FX_RATE);
  if (fromEnv > 0) return fromEnv;
  return currency === 'USD' ? 125 : 1;
}

const cache = new Map<string, { at: number; data: AdsSnapshot }>();
const CACHE_MS = 10 * 60_000;

// `fxOverride` converts the ad account's currency into taka (ignored when the
// account is already billed in BDT). Every money figure in the snapshot is in
// taka.
export async function fetchAdsSnapshot(days: number, fxOverride?: number, fresh = false): Promise<AdsSnapshot> {
  if (!token()) {
    throw new MetaAdsError('No Meta access token is configured.', 'not_configured');
  }
  const accountId = await resolveAccountId();
  const info = await graph<{ name: string; currency: string; timezone_name: string }>(`act_${accountId}`, {
    fields: 'name,currency,timezone_name',
  });
  const fx = info.currency !== 'BDT' && fxOverride && fxOverride > 0 ? fxOverride : defaultFx(info.currency);

  const range = resolveRange(days);
  const key = `${accountId}|${range.since}|${range.until}|${fx}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [rawC, rawS, rawA, rawPrev, rawDaily, metaC, metaS, metaA] = await Promise.all([
    insights(accountId, 'campaign', range.since, range.until),
    insights(accountId, 'adset', range.since, range.until),
    insights(accountId, 'ad', range.since, range.until),
    insights(accountId, 'ad', range.prevSince, range.prevUntil),
    insights(accountId, 'account', range.prevSince, range.until, true),
    entities(accountId, 'campaigns', 'id,effective_status,daily_budget'),
    entities(accountId, 'adsets', 'id,effective_status,daily_budget,learning_stage_info'),
    entities(accountId, 'ads', 'id,effective_status'),
  ]);

  const row = (level: AdsLevel, r: RawInsight, meta: Map<string, RawEntity>): AdsRow => {
    const id = (level === 'campaign' ? r.campaign_id : level === 'adset' ? r.adset_id : r.ad_id) || '';
    const name = (level === 'campaign' ? r.campaign_name : level === 'adset' ? r.adset_name : r.ad_name) || '(unnamed)';
    const m = meta.get(id);
    return {
      ...toMetrics(r, fx),
      level,
      id,
      name,
      campaignId: r.campaign_id || '',
      campaignName: r.campaign_name || '',
      adsetId: r.adset_id,
      adsetName: r.adset_name,
      status: m?.effective_status,
      // Budgets come back in the currency's minor unit (cents, poisha).
      dailyBudget: m?.daily_budget ? (Number(m.daily_budget) / 100) * fx : undefined,
      learning: m?.learning_stage_info?.status,
    };
  };

  const campaigns = rawC.map((r) => row('campaign', r, metaC));
  const adsets = rawS.map((r) => row('adset', r, metaS));
  const ads = rawA.map((r) => row('ad', r, metaA));

  const daily: AdsDay[] = rawDaily
    .map((r) => ({ ...toMetrics(r, fx), date: r.date_start || '' }))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const sum = (rows: AdsMetrics[]): AdsMetrics => {
    const t = { ...ZERO };
    for (const r of rows) {
      t.spend += r.spend; t.impressions += r.impressions; t.linkClicks += r.linkClicks;
      t.landingPageViews += r.landingPageViews; t.viewContent += r.viewContent;
      t.addToCart += r.addToCart; t.initiateCheckout += r.initiateCheckout;
      t.purchases += r.purchases; t.purchaseValue += r.purchaseValue;
    }
    return t;
  };

  const totals = sum(daily.filter((d) => d.date >= range.since));
  const prevTotals = sum(daily.filter((d) => d.date < range.since));
  // Reach cannot be added up across days or campaigns (the same person is
  // counted in each), so account frequency is an impressions-weighted average
  // of the campaign figures: close enough to tell 1.3 from 3.5.
  const freqImps = campaigns.reduce((s, c) => s + (c.frequency > 0 ? c.impressions : 0), 0);
  totals.frequency = freqImps ? campaigns.reduce((s, c) => s + c.frequency * c.impressions, 0) / freqImps : 0;

  const prevAds: Record<string, AdsMetrics> = {};
  for (const r of rawPrev) if (r.ad_id) prevAds[r.ad_id] = toMetrics(r, fx);

  const data: AdsSnapshot = {
    account: { id: accountId, name: info.name, currency: info.currency, timezone: info.timezone_name, fx },
    ...range,
    totals,
    prevTotals,
    campaigns,
    adsets,
    ads,
    prevAds,
    daily,
    fetchedAt: Date.now(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
