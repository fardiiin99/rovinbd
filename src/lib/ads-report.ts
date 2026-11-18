import { db } from './db';
import { advise, storeEconomics, type Advice, type StoreEconomics } from './ads-advisor';
import { dhakaDayBounds, fetchAdsSnapshot, type AdsSnapshot } from './meta-ads';

export type AdsReport = {
  days: number;
  snapshot: AdsSnapshot;
  store: StoreEconomics;
  advice: Advice;
};

export const ALLOWED_DAYS = [1, 7, 14, 30];

export async function buildAdsReport(days: number, fx?: number, fresh = false): Promise<AdsReport> {
  const snapshot = await fetchAdsSnapshot(days, fx, fresh);
  const [orders, products, content] = await Promise.all([db.listOrders(), db.listProducts(), db.getContent()]);
  const { from, to } = dhakaDayBounds(snapshot.since, snapshot.until);
  const store = storeEconomics(orders, products, content, from, to);
  return { days, snapshot, store, advice: advise(snapshot, store, days) };
}

const tk = (n: number) => '৳' + Math.round(n).toLocaleString('en-BD');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Telegram HTML. Kept to the headline numbers and the actions that matter;
// the admin page has the rest.
export function digestText(r: AdsReport): string {
  const t = r.snapshot.totals;
  const b = r.advice.benchmarks;
  const cpa = t.purchases ? tk(t.spend / t.purchases) : '—';
  const period = r.days <= 1 ? `today (${r.snapshot.since})` : `last ${r.days} days (${r.snapshot.since} → ${r.snapshot.until})`;
  const icon = { critical: '🔴', warning: '🟠', opportunity: '🟢', info: 'ℹ️' } as const;
  const top = r.advice.recommendations.filter((x) => x.severity !== 'info').slice(0, 6);

  const lines = [
    `📊 <b>Meta ads — ${period}</b>`,
    ``,
    `<b>Spend:</b> ${tk(t.spend)}`,
    `<b>Meta purchases:</b> ${t.purchases} · <b>cost per order:</b> ${cpa}`,
    `<b>Store orders:</b> ${r.store.ordersPlaced} (${tk(r.store.ordersValue)})`,
    ...(b.breakEvenCpa
      ? [`<b>Break-even cost per order:</b> ${tk(b.breakEvenCpa)}${b.basis === 'store' ? '' : ' (account average)'}`]
      : []),
    ``,
    top.length ? `<b>Do next:</b>` : `No changes needed right now.`,
    ...top.map((x) => `${icon[x.severity]} <b>${esc(x.title)}</b>${x.entityName ? ` — ${esc(x.entityName)}` : ''}\n${esc(x.why)}`),
    ``,
    `<a href="https://www.rovinbd.com/admin/ads">Open the full report →</a>`,
  ];
  return lines.join('\n');
}

export async function sendDigest(r: AdsReport): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chat) return { ok: false, error: 'Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: digestText(r), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) return { ok: false, error: `Telegram returned ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
