'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPrice } from '@/lib/format';
import type { AdsLevel, AdsMetrics, AdsRow } from '@/lib/meta-ads';
import type { Recommendation, Severity, Verdict } from '@/lib/ads-advisor';
import type { AdsReport } from '@/lib/ads-report';
import LineChart from '../finance/LineChart';

type Setup = {
  state: 'setup';
  kind: 'not_configured' | 'permission' | 'pick_account' | 'api';
  message: string;
  accounts: { id: string; name: string }[];
  tokenSource: string | null;
};
type Ok = { state: 'ok' } & AdsReport;

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
];

const SEVERITY: Record<Severity, { label: string; bar: string; chip: string }> = {
  critical: { label: 'Act now', bar: 'border-l-rose-500', chip: 'bg-rose-50 text-rose-700' },
  warning: { label: 'Fix', bar: 'border-l-amber-500', chip: 'bg-amber-50 text-amber-800' },
  opportunity: { label: 'Opportunity', bar: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  info: { label: 'Note', bar: 'border-l-stone-300', chip: 'bg-stone-100 text-stone-600' },
};

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  scale: { label: 'Scale', cls: 'bg-emerald-50 text-emerald-700' },
  keep: { label: 'Keep', cls: 'bg-stone-100 text-stone-700' },
  watch: { label: 'Watch', cls: 'bg-amber-50 text-amber-800' },
  cut: { label: 'Cut', cls: 'bg-orange-50 text-orange-700' },
  pause: { label: 'Pause', cls: 'bg-rose-50 text-rose-700' },
  learning: { label: 'Learning', cls: 'bg-blue-50 text-blue-700' },
  off: { label: 'Off', cls: 'bg-stone-50 text-stone-400' },
};

const SCOPE_LABEL: Record<Recommendation['scope'], string> = {
  account: 'Account', campaign: 'Campaign', adset: 'Ad set', ad: 'Ad',
};

const money = (n: number) => (n < 0 ? '-' : '') + formatPrice(Math.abs(Math.round(n)));
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const cpa = (m: AdsMetrics) => (m.purchases > 0 ? m.spend / m.purchases : null);
const roas = (m: AdsMetrics) => (m.spend > 0 ? m.purchaseValue / m.spend : null);
const ctr = (m: AdsMetrics) => (m.impressions > 0 ? m.linkClicks / m.impressions : null);
const cpm = (m: AdsMetrics) => (m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null);

function managerUrl(accountId: string, level: AdsLevel, id: string): string {
  const tab = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${accountId}&selected_${level}_ids=${id}`;
}

export default function AdsView() {
  const [days, setDays] = useState(7);
  // null until the saved rate has been read, so the first request already
  // carries it instead of fetching twice.
  const [fx, setFx] = useState<string | null>(null);
  const [fxDraft, setFxDraft] = useState('');
  const [data, setData] = useState<Ok | Setup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<AdsLevel>('adset');
  const [sending, setSending] = useState(false);
  const [digestMsg, setDigestMsg] = useState('');

  useEffect(() => {
    let saved = '';
    try { saved = window.localStorage.getItem('ads-fx') || ''; } catch { /* storage blocked: use the default rate */ }
    setFx(saved);
    setFxDraft(saved);
  }, []);

  const load = useCallback(async (fresh: boolean) => {
    if (fx === null) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ days: String(days) });
    if (Number(fx) > 0) params.set('fx', fx);
    if (fresh) params.set('fresh', '1');
    try {
      const res = await fetch(`/api/admin/ads?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error || `Could not load the report (HTTP ${res.status}).`);
      else setData(body);
    } catch {
      setError('Could not reach the server.');
    }
    setLoading(false);
  }, [days, fx]);

  useEffect(() => { load(false); }, [load]);

  const applyFx = (e: React.FormEvent) => {
    e.preventDefault();
    if (!(Number(fxDraft) > 0)) return;
    try { window.localStorage.setItem('ads-fx', fxDraft); } catch { /* storage blocked: rate just won't persist */ }
    setFx(fxDraft);
  };

  const sendDigest = async () => {
    setSending(true);
    setDigestMsg('');
    try {
      const res = await fetch(`/api/admin/ads/digest?days=${days}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      setDigestMsg(res.ok ? 'Sent to Telegram.' : body.error || 'Could not send.');
    } catch {
      setDigestMsg('Could not reach the server.');
    }
    setSending(false);
  };

  const rangeBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`px-3 py-1.5 text-sm rounded-md ${days === r.days ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button onClick={() => load(true)} disabled={loading} className="btn btn-outline">
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  );

  if (!data) {
    return (
      <div className="mt-6 space-y-4">
        {rangeBar}
        {error
          ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{error}</div>
          : <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-500">Loading from Meta…</div>}
      </div>
    );
  }

  if (data.state === 'setup') return <div className="mt-6 space-y-4">{rangeBar}<SetupPanel setup={data} /></div>;

  return (
    <Report
      data={data}
      rangeBar={rangeBar}
      error={error}
      loading={loading}
      level={level}
      setLevel={setLevel}
      fxDraft={fxDraft}
      setFxDraft={setFxDraft}
      applyFx={applyFx}
      sendDigest={sendDigest}
      sending={sending}
      digestMsg={digestMsg}
    />
  );
}

function Report(props: {
  data: Ok;
  rangeBar: React.ReactNode;
  error: string;
  loading: boolean;
  level: AdsLevel;
  setLevel: (l: AdsLevel) => void;
  fxDraft: string;
  setFxDraft: (v: string) => void;
  applyFx: (e: React.FormEvent) => void;
  sendDigest: () => void;
  sending: boolean;
  digestMsg: string;
}) {
  const { data, level } = props;
  const { snapshot: snap, store, advice } = data;
  const t = snap.totals;
  const p = snap.prevTotals;
  const b = advice.benchmarks;
  const foreign = snap.account.currency !== 'BDT';

  const rows: AdsRow[] = useMemo(() => {
    const src = level === 'campaign' ? snap.campaigns : level === 'adset' ? snap.adsets : snap.ads;
    return [...src].sort((x, y) => y.spend - x.spend);
  }, [level, snap]);

  const spendPoints = useMemo(
    () => snap.daily
      .filter((d) => d.date >= snap.since)
      .map((d) => ({ date: Date.parse(`${d.date}T12:00:00+06:00`), value: Math.round(d.spend) })),
    [snap],
  );

  const tCpa = cpa(t);
  const blended = store.ordersPlaced > 0 ? t.spend / store.ordersPlaced : null;
  // Uses store orders, not Meta's count: what was actually placed, valued at
  // what an average placed order ends up earning once returns are in.
  const estProfit = b.basis === 'store' ? store.ordersPlaced * store.profitPerOrder - t.spend : null;
  const actions = advice.recommendations.filter((r) => r.severity !== 'info');
  const notes = advice.recommendations.filter((r) => r.severity === 'info');
  const span = (a: string, z: string) => (a === z ? a : `${a} to ${z}`);

  return (
    <div className={`mt-6 space-y-6 ${props.loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-end gap-3">
        {props.rangeBar}
        {foreign && (
          <form onSubmit={props.applyFx} className="flex items-end gap-2">
            <div>
              <label className="label">৳ per 1 {snap.account.currency}</label>
              <input
                className="input w-28"
                inputMode="decimal"
                value={props.fxDraft}
                placeholder={String(snap.account.fx)}
                onChange={(e) => props.setFxDraft(e.target.value)}
              />
            </div>
            <button className="btn btn-outline">Apply</button>
          </form>
        )}
        <div className="ml-auto flex flex-col items-end gap-1">
          <button onClick={props.sendDigest} disabled={props.sending} className="btn btn-primary">
            {props.sending ? 'Sending…' : 'Send summary to Telegram'}
          </button>
          {props.digestMsg && <div className="text-xs text-stone-600 max-w-xs text-right">{props.digestMsg}</div>}
        </div>
      </div>

      {props.error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{props.error}</div>}

      <div className="text-xs text-stone-500">
        {snap.account.name} · {span(snap.since, snap.until)} · compared with {span(snap.prevSince, snap.prevUntil)}
        {foreign && ` · billed in ${snap.account.currency}, shown in taka at ৳${snap.account.fx} per 1 (set the rate you actually pay above)`}
      </div>

      {/* Headline */}
      <div className="rounded-2xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Cost per order (Meta)</div>
            <div className={`text-4xl font-bold mt-1 ${tCpa == null || !b.breakEvenCpa ? 'text-stone-900' : tCpa <= b.breakEvenCpa ? 'text-emerald-700' : 'text-rose-700'}`}>
              {tCpa == null ? '—' : money(tCpa)}
            </div>
            <div className="text-sm text-stone-500 mt-1">
              {b.basis === 'store' && <>Break-even {money(b.breakEvenCpa!)} · aim under {money(b.targetCpa!)}</>}
              {b.basis === 'account-average' && 'Break-even not measured yet, see notes below.'}
              {b.basis === 'none' && 'No break-even yet: not enough finalized orders or purchases.'}
            </div>
            <div className="text-sm text-stone-500 mt-1">
              <Delta now={tCpa} before={cpa(p)} goodWhenDown /> vs previous period
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4 text-right">
            <Kpi label="Spend" value={money(t.spend)} now={t.spend} before={p.spend} neutral />
            <Kpi label="Meta purchases" value={String(t.purchases)} now={t.purchases} before={p.purchases} />
            <Kpi label="ROAS (Meta)" value={roas(t) == null ? '—' : `${roas(t)!.toFixed(2)}×`} now={roas(t)} before={roas(p)} />
            <Kpi label="Link CTR" value={ctr(t) == null ? '—' : pct(ctr(t)!, 2)} now={ctr(t)} before={ctr(p)} />
            <Kpi label="CPM" value={cpm(t) == null ? '—' : money(cpm(t)!)} now={cpm(t)} before={cpm(p)} goodWhenDown />
            <Kpi label="Frequency" value={t.frequency ? t.frequency.toFixed(2) : '—'} />
          </div>
        </div>
      </div>

      {/* Store reality */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          label="Store orders in this period"
          value={String(store.ordersPlaced)}
          sub={`${store.ordersFromAdClick} came from a Facebook ad click · Meta claims ${t.purchases}`}
        />
        <Card
          label="Ad spend per store order"
          value={blended == null ? '—' : money(blended)}
          sub="All spend ÷ all orders, whatever Meta attributed"
        />
        <Card
          label="Return rate (90 days)"
          value={store.finalizedOrders ? pct(store.returnRate, 0) : '—'}
          sub={`${store.finalizedOrders} delivered or returned orders`}
        />
        <Card
          label="Est. profit after ads"
          value={estProfit == null ? '—' : money(estProfit)}
          tone={estProfit == null ? undefined : estProfit >= 0 ? 'green' : 'red'}
          sub={estProfit == null
            ? 'Needs product costs and 15+ finalized orders'
            : `${store.ordersPlaced} orders × ${money(store.profitPerOrder)} expected each, minus spend`}
        />
      </div>

      {/* Recommendations */}
      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-baseline justify-between gap-3">
          <div className="font-semibold">What to do next</div>
          <div className="text-xs text-stone-500">{actions.length} action(s), most money at stake first</div>
        </div>
        {actions.length === 0 && (
          <div className="p-6 text-sm text-stone-600">Nothing needs changing on these numbers. Leave the ad sets alone and check again in a few days.</div>
        )}
        <ul className="divide-y divide-stone-100">
          {actions.map((r) => <RecItem key={r.id} rec={r} accountId={snap.account.id} />)}
        </ul>
        {notes.length > 0 && (
          <ul className="divide-y divide-stone-100 border-t border-stone-100 bg-stone-50/60">
            {notes.map((r) => <RecItem key={r.id} rec={r} accountId={snap.account.id} />)}
          </ul>
        )}
      </div>

      {/* Trend + funnel */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-5">
          <LineChart points={spendPoints} label="Daily ad spend" />
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500 mb-3">Funnel from ad click to order</div>
          <Funnel t={t} />
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold">Breakdown</div>
          <div className="inline-flex rounded-lg border border-stone-300 p-0.5">
            {(['campaign', 'adset', 'ad'] as AdsLevel[]).map((l) => (
              <button
                key={l}
                onClick={() => props.setLevel(l)}
                className={`px-3 py-1 text-sm rounded-md ${level === l ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
              >
                {l === 'campaign' ? 'Campaigns' : l === 'adset' ? 'Ad sets' : 'Ads'}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-stone-50 text-stone-500 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Verdict</th>
                <th className="px-4 py-2.5 text-right">Spend</th>
                <th className="px-4 py-2.5 text-right">Orders</th>
                <th className="px-4 py-2.5 text-right">Cost / order</th>
                <th className="px-4 py-2.5 text-right">ROAS</th>
                <th className="px-4 py-2.5 text-right">CTR</th>
                <th className="px-4 py-2.5 text-right">CPM</th>
                <th className="px-4 py-2.5 text-right">Freq.</th>
                <th className="px-4 py-2.5 text-right">Budget / day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => {
                const v = VERDICT[advice.verdicts[r.id] ?? 'keep'];
                const rc = cpa(r);
                const over = rc != null && b.breakEvenCpa != null && rc > b.breakEvenCpa;
                return (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5 max-w-[280px]">
                      <a
                        href={managerUrl(snap.account.id, r.level, r.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-stone-900 hover:text-brand-700 hover:underline break-words"
                      >
                        {r.name}
                      </a>
                      {r.level !== 'campaign' && (
                        <div className="text-xs text-stone-400 truncate">{r.level === 'ad' ? r.adsetName : r.campaignName}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${v.cls}`}>{v.label}</span></td>
                    <td className="px-4 py-2.5 text-right">{money(r.spend)}</td>
                    <td className="px-4 py-2.5 text-right">{r.purchases}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${over ? 'text-rose-700' : ''}`}>{rc == null ? '—' : money(rc)}</td>
                    <td className="px-4 py-2.5 text-right">{roas(r) == null ? '—' : `${roas(r)!.toFixed(2)}×`}</td>
                    <td className="px-4 py-2.5 text-right">{ctr(r) == null ? '—' : pct(ctr(r)!, 2)}</td>
                    <td className="px-4 py-2.5 text-right">{cpm(r) == null ? '—' : money(cpm(r)!)}</td>
                    <td className="px-4 py-2.5 text-right">{r.frequency ? r.frequency.toFixed(2) : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-stone-600">{r.dailyBudget ? money(r.dailyBudget) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="p-8 text-center text-stone-500">Nothing delivered in this range.</div>}
        </div>
      </div>

      <p className="text-xs text-stone-400">
        Read-only: this page never changes anything in the ad account. Meta figures use Meta&apos;s default attribution and can lag by a few hours;
        store figures come from this site&apos;s orders. Cached for up to 10 minutes; Refresh pulls new numbers.
      </p>
    </div>
  );
}

function RecItem({ rec, accountId }: { rec: Recommendation; accountId: string }) {
  const s = SEVERITY[rec.severity];
  return (
    <li className={`border-l-4 ${s.bar} px-5 py-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.chip}`}>{s.label}</span>
        <span className="text-xs text-stone-500">{SCOPE_LABEL[rec.scope]}</span>
        {rec.entityName && rec.entityId && rec.scope !== 'account' && (
          <a
            href={managerUrl(accountId, rec.scope, rec.entityId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-stone-700 hover:text-brand-700 hover:underline break-all"
          >
            {rec.entityName}{rec.parentName ? ` · in ${rec.parentName}` : ''} ↗
          </a>
        )}
      </div>
      <div className="font-semibold mt-1.5">{rec.title}</div>
      <div className="text-sm text-stone-800 mt-1">{rec.action}</div>
      <div className="text-xs text-stone-500 mt-1.5">{rec.why}</div>
    </li>
  );
}

function Delta({ now, before, goodWhenDown, neutral }: { now: number | null; before: number | null; goodWhenDown?: boolean; neutral?: boolean }) {
  if (now == null || before == null || before === 0) return <span className="text-stone-400">no comparison</span>;
  const change = now / before - 1;
  if (Math.abs(change) < 0.005) return <span className="text-stone-500">flat</span>;
  const good = goodWhenDown ? change < 0 : change > 0;
  const cls = neutral ? 'text-stone-500' : good ? 'text-emerald-700' : 'text-rose-700';
  return <span className={cls}>{change > 0 ? '▲' : '▼'} {Math.abs(change * 100).toFixed(0)}%</span>;
}

function Kpi(props: { label: string; value: string; now?: number | null; before?: number | null; goodWhenDown?: boolean; neutral?: boolean }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{props.label}</div>
      <div className="text-base font-semibold text-stone-900">{props.value}</div>
      {props.now !== undefined && (
        <div className="text-xs">
          <Delta now={props.now ?? null} before={props.before ?? null} goodWhenDown={props.goodWhenDown} neutral={props.neutral} />
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  const cls = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-stone-900';
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}

function Funnel({ t }: { t: AdsMetrics }) {
  const steps = [
    { label: 'Link clicks', value: t.linkClicks },
    { label: 'Landing page views', value: t.landingPageViews },
    { label: 'Add to cart', value: t.addToCart },
    { label: 'Checkout started', value: t.initiateCheckout },
    { label: 'Purchases', value: t.purchases },
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-stone-700">{s.label}</span>
              <span className="font-semibold text-stone-900">
                {s.value.toLocaleString()}
                {i > 0 && prev > 0 && <span className="ml-2 text-xs font-normal text-stone-500">{pct(s.value / prev, 0)} of previous</span>}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-stone-100">
              <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 2 : 0)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SetupPanel({ setup }: { setup: Setup }) {
  const usingCapi = setup.tokenSource === 'META_CAPI_ACCESS_TOKEN';
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 space-y-4">
      <div>
        <div className="font-semibold text-amber-900">
          {setup.kind === 'pick_account' ? 'Choose which ad account to report on' : 'Connect the ad account to see the report'}
        </div>
        <div className="text-sm text-amber-900/80 mt-1">Meta said: {setup.message}</div>
        {usingCapi && setup.kind !== 'pick_account' && (
          <div className="text-sm text-amber-900/80 mt-1">
            The site tried the Conversions API token, which normally can only send pixel events. Reading ad results needs its own token.
          </div>
        )}
      </div>

      {setup.kind === 'pick_account' ? (
        <div className="text-sm text-stone-800 space-y-2">
          <p>Set <code className="bg-white px-1 rounded">META_AD_ACCOUNT_ID</code> on the server to one of these, then redeploy:</p>
          <ul className="list-disc pl-5">
            {setup.accounts.map((a) => <li key={a.id}><code className="bg-white px-1 rounded">{a.id}</code> — {a.name}</li>)}
          </ul>
        </div>
      ) : (
        <ol className="list-decimal pl-5 text-sm text-stone-800 space-y-1.5">
          <li>In Meta Business Settings open <b>Users → System users</b> and pick (or add) a system user.</li>
          <li>Under <b>Assign assets</b> give it your ad account with <b>View performance</b> only. It does not need to manage campaigns.</li>
          <li>Click <b>Generate token</b>, choose your app, tick the <b>ads_read</b> permission and set it to never expire.</li>
          <li>On the server set <code className="bg-white px-1 rounded">META_ADS_ACCESS_TOKEN</code> to that token and <code className="bg-white px-1 rounded">META_AD_ACCOUNT_ID</code> to the account number (Ads Manager URL, <code className="bg-white px-1 rounded">act=…</code>).</li>
          <li>Redeploy and reload this page.</li>
        </ol>
      )}
    </div>
  );
}
