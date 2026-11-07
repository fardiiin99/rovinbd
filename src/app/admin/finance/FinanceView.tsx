'use client';
import { useMemo, useState } from 'react';
import { formatPrice, formatDate } from '@/lib/format';
import type { FinanceOrderRow, FinanceSummary } from '@/lib/finance';
import LineChart from './LineChart';
import StatusBreakdown, { returnLossNote } from './StatusBreakdown';

type FinanceData = { summary: FinanceSummary; orders: FinanceOrderRow[] };

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-blue-50 text-blue-700' },
  dispatched: { label: 'Dispatched', cls: 'bg-blue-50 text-blue-700' },
  received: { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700' },
  returned: { label: 'Returned', cls: 'bg-rose-50 text-rose-700' },
};

function netContribution(o: FinanceOrderRow): number {
  if (o.status === 'received') return o.revenue - o.cogs - o.deliveryFee;
  if (o.status === 'returned') return o.revenue - o.returnDeduction;
  return 0;
}

export default function FinanceView({ initial }: { initial: FinanceData }) {
  const [data, setData] = useState<FinanceData>(initial);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [reconcileText, setReconcileText] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const load = async (fromDate: string, toDate: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set('from', String(new Date(fromDate + 'T00:00:00').getTime()));
    if (toDate) params.set('to', String(new Date(toDate + 'T23:59:59').getTime()));
    const res = await fetch(`/api/admin/finance?${params.toString()}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  const applyRange = (e: React.FormEvent) => {
    e.preventDefault();
    load(from, to);
  };

  const clearRange = () => {
    setFrom(''); setTo('');
    load('', '');
  };

  const sync = async () => {
    setSyncing(true);
    setSyncMsg('');
    const res = await fetch('/api/admin/finance/sync', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setSyncing(false);
    if (res.ok) {
      setSyncMsg(
        `Checked ${d.checked} order(s), updated ${d.updated}.` +
        (d.remaining > 0 ? ` ${d.remaining} more still pending — click Sync again to continue.` : '') +
        (d.errors?.length ? ` ${d.errors.length} lookup error(s).` : ''),
      );
      load(from, to);
    } else {
      setSyncMsg(d.error || 'Sync failed');
    }
  };

  const reconcile = async () => {
    const rows = reconcileText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t|,/).map((p) => p.trim());
        const key = parts[0]?.replace(/^#/, '') || '';
        const fee = Number((parts[1] || '').replace(/[^\d.-]/g, ''));
        return { key, fee };
      })
      .filter((r) => r.key);

    if (rows.length === 0) {
      setReconcileMsg('Paste at least one row: Order ID or Consignment ID, then the actual charge.');
      return;
    }
    setReconciling(true);
    setReconcileMsg('');
    const res = await fetch('/api/admin/finance/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    const d = await res.json().catch(() => ({}));
    setReconciling(false);
    if (res.ok) {
      setReconcileMsg(
        `Matched ${d.matched.length} order(s).` +
        (d.unmatched.length ? ` Couldn't match: ${d.unmatched.join(', ')}` : ''),
      );
      if (d.matched.length) load(from, to);
    } else {
      setReconcileMsg(d.error || 'Reconcile failed');
    }
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    setImportMsg('');
    const csv = await file.text();
    const res = await fetch('/api/admin/finance/import-pathao-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    });
    const d = await res.json().catch(() => ({}));
    setImporting(false);
    if (res.ok) {
      setImportMsg(
        `${d.rowsInCsv} delivery row(s) in file — ${d.matchedByConsignment} matched by consignment, ${d.linkedByPhone} newly linked by phone, updated ${d.feeUpdated} fee(s), ${d.statusUpdated} status(es).` +
        (d.ambiguous.length ? ` Ambiguous (multiple possible matches): ${d.ambiguous.join('; ')}` : '') +
        (d.unmatched.length ? ` Couldn't match: ${d.unmatched.join(', ')}` : ''),
      );
      load(from, to);
    } else {
      setImportMsg(d.error || 'Import failed');
    }
  };

  const { summary } = data;

  const trendPoints = useMemo(() => {
    const byDay = new Map<number, number>();
    for (const o of data.orders) {
      if (o.status !== 'received' && o.status !== 'returned') continue;
      const d = new Date(o.createdAt);
      d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      byDay.set(key, (byDay.get(key) || 0) + netContribution(o));
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([date, value]) => ({ date, value }));
  }, [data.orders]);

  const statusCounts = useMemo(() => {
    let paidReturn = 0, returned = 0;
    for (const o of data.orders) {
      if (o.status !== 'returned') continue;
      if (o.revenue > 0) paidReturn++; else returned++;
    }
    return {
      received: summary.deliveredCount,
      paidReturn,
      returned,
      pending: summary.pendingCount,
    };
  }, [data.orders, summary.deliveredCount, summary.pendingCount]);

  return (
    <div className="mt-6 space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={applyRange} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn btn-outline" disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
          {(from || to) && <button type="button" onClick={clearRange} className="btn btn-outline">Clear</button>}
        </form>
        <div className="ml-auto flex flex-col items-end gap-1">
          <button onClick={sync} disabled={syncing} className="btn btn-primary">
            {syncing ? 'Syncing with Pathao…' : 'Sync statuses with Pathao'}
          </button>
          {syncMsg && <div className="text-xs text-stone-600 max-w-xs text-right">{syncMsg}</div>}
        </div>
      </div>

      {/* Hero KPI */}
      <div className="rounded-2xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Net profit</div>
            <div className={`text-4xl font-bold mt-1 ${summary.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatPrice(summary.netProfit)}
            </div>
            <div className="text-sm text-stone-500 mt-1">
              {summary.deliveredCount} delivered · {summary.returnedCount} returned ({summary.paidReturnCount} paid) · {summary.pendingCount} pending
            </div>
            <div className="text-xs text-stone-500 mt-1">
              Pathao recorded {formatPrice(summary.deliveredCollectedRevenue)} collected across {summary.deliveredWithCollectionCount} delivered orders.
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 text-right">
            <KpiInline label="Revenue" value={formatPrice(summary.revenue)} />
            <KpiInline label="COGS" value={'-' + formatPrice(summary.cogs)} />
            <KpiInline label="Delivery cost" value={'-' + formatPrice(summary.deliveryCost)} />
            <KpiInline label="Return cost" value={'-' + formatPrice(summary.returnCost)} />
          </div>
        </div>
      </div>

      {/* Trend + breakdown */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-5">
          <LineChart points={trendPoints} label="Daily net profit" />
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="text-sm text-stone-500 mb-3">Order status</div>
          <StatusBreakdown counts={statusCounts} />
          <div className="text-xs text-stone-400 mt-4 pt-3 border-t border-stone-100">{returnLossNote(summary.returnCost)}</div>
        </div>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Delivery profit"
          value={formatPrice(summary.deliveryProfit)}
          sub="Charged to customer minus Pathao's actual fee"
          highlight={summary.deliveryProfit >= 0 ? 'green' : 'red'}
        />
        <SummaryCard label="Return cost formula" value="1.5× / 0.5×" sub="Return: 1.5× delivery fee · Paid return: 0.5× delivery fee" />
        <SummaryCard label="Pipeline (not yet final)" value={formatPrice(summary.pendingValue)} sub={`${summary.pendingCount} order(s) pending/in transit`} />
      </div>

      {/* Data tools — collapsible */}
      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <button onClick={() => setToolsOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left">
          <span className="font-semibold">Data &amp; sync tools</span>
          <span className="text-stone-400 text-sm">{toolsOpen ? 'Hide ▲' : 'Show ▼'}</span>
        </button>
        {toolsOpen && (
          <div className="border-t border-stone-100 p-5 space-y-5">
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Import Pathao CSV</h3>
              <p className="text-sm text-stone-500">
                From the Pathao merchant panel: Deliveries → Export CSV. Upload it here — it has the real total fee (delivery + COD fee) and live
                order status per order, so this updates both delivery cost and order status (delivered/returned) in one go.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  disabled={importing}
                  onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])}
                />
                {importing && <span className="text-sm text-stone-500">Importing…</span>}
              </div>
              {importMsg && <div className="text-xs text-stone-600">{importMsg}</div>}
            </div>

            <div className="space-y-2 pt-4 border-t border-stone-100">
              <h3 className="font-medium text-sm">Reconcile manually</h3>
              <p className="text-sm text-stone-500">
                For one-off corrections without a full CSV export. Paste rows (Order ID or Consignment ID, then the actual charge).
                One per line — <code className="text-xs bg-stone-100 px-1 rounded">1161, 59.30</code> or paste straight from a spreadsheet (tab-separated).
              </p>
              <textarea
                className="input font-mono text-sm"
                rows={4}
                placeholder={'1161, 59.30\n1160, 59.30\nDC130726PCZ7ER, 66.30'}
                value={reconcileText}
                onChange={(e) => setReconcileText(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <button onClick={reconcile} disabled={reconciling} className="btn btn-outline">
                  {reconciling ? 'Reconciling…' : 'Reconcile'}
                </button>
                {reconcileMsg && <div className="text-xs text-stone-600">{reconcileMsg}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Orders table */}
      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 font-semibold">Orders</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[940px]">
            <thead className="bg-stone-50 text-stone-500 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Revenue</th>
                <th className="px-4 py-2.5 text-right">COGS</th>
                <th className="px-4 py-2.5 text-right">Delivery</th>
                <th className="px-4 py-2.5 text-right">Delivery profit</th>
                <th className="px-4 py-2.5">Consignment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.orders.map((o) => {
                const isPaidReturn = o.status === 'returned' && o.revenue > 0;
                const s = isPaidReturn
                  ? { label: 'Paid Return (PR)', cls: 'bg-amber-50 text-amber-700' }
                  : STATUS_MAP[o.status] ?? { label: o.status, cls: 'bg-stone-100 text-stone-600' };
                return (
                  <tr key={o.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5 font-semibold">#{o.orderNumber}</td>
                    <td className="px-4 py-2.5">{o.customerName}</td>
                    <td className="px-4 py-2.5 text-stone-600 whitespace-nowrap">{formatDate(o.createdAt)}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span></td>
                    <td className="px-4 py-2.5 text-right">{o.revenue > 0 ? formatPrice(o.revenue) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{o.cogs > 0 ? formatPrice(o.cogs) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {formatPrice(o.deliveryFee)}
                      {o.deliveryFeeIsEstimate && <span className="text-amber-600" title="Estimated from delivery charge collected — actual Pathao fee unknown">*</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {o.deliveryFeeIsEstimate ? '—' : formatPrice(o.deliveryProfit)}
                    </td>
                    <td className="px-4 py-2.5 text-stone-600">{o.pathaoConsignmentId || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.orders.length === 0 && <div className="p-8 text-center text-stone-500">No orders in this range.</div>}
        </div>
      </div>
    </div>
  );
}

function KpiInline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-base font-semibold text-stone-900">{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'green' | 'red' }) {
  const valueCls = highlight === 'green' ? 'text-emerald-700' : highlight === 'red' ? 'text-rose-700' : 'text-stone-900';
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueCls}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500 mt-1">{sub}</div>}
    </div>
  );
}
