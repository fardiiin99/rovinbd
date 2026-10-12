'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type OrderRow = {
  id: string;
  orderNumber: number;
  customerName: string;
  customerEmail: string;
  date: string;
  qty: number;
  payment: string;
  total: string;
  status: string;
  pathaoConsignmentId?: string;
};

type SendResult = { id: string; orderNumber?: number; ok: boolean; consignmentId?: string; error?: string; skipped?: boolean };

export default function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState('');

  const sendable = orders.filter((o) => !o.pathaoConsignmentId);
  const allSelected = sendable.length > 0 && sendable.every((o) => selected.has(o.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sendable.map((o) => o.id)));
  }

  async function send() {
    if (selected.size === 0) return;
    if (!confirm(`Send ${selected.size} order(s) to Pathao? A pickup will be created for each.`)) return;
    setSending(true);
    setError('');
    setResults(null);
    try {
      const res = await fetch('/api/admin/orders/send-pathao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResults(data.results);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const failed = results?.filter((r) => !r.ok) ?? [];
  const sent = results?.filter((r) => r.ok && !r.skipped) ?? [];

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={selected.size === 0 || sending}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending to Pathao…' : `Send to Pathao${selected.size ? ` (${selected.size})` : ''}`}
        </button>
        <span className="text-sm text-stone-500">Orders already sent to Pathao can&apos;t be selected.</span>
      </div>

      {error && <div className="mt-3 rounded bg-red-50 text-red-700 text-sm px-4 py-2">{error}</div>}
      {results && (
        <div className="mt-3 rounded bg-stone-50 text-sm px-4 py-3 space-y-1">
          {sent.length > 0 && (
            <div className="text-green-700">
              Sent {sent.length}: {sent.map((r) => `#${r.orderNumber} → ${r.consignmentId}`).join(', ')}
            </div>
          )}
          {failed.map((r) => (
            <div key={r.id} className="text-red-700">
              #{r.orderNumber ?? r.id} failed: {r.error}
            </div>
          ))}
        </div>
      )}

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-stone-50 text-stone-600 text-left">
            <tr>
              <th className="px-4 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all unsent orders" />
              </th>
              <th className="px-4 py-2">Order ID</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Items</th>
              <th className="px-4 py-2">Payment</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Pathao</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orders.map((o) => (
              <tr key={o.id} className={`hover:bg-stone-50 ${selected.has(o.id) ? 'bg-brand-50' : ''}`}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    disabled={!!o.pathaoConsignmentId}
                    onChange={() => toggle(o.id)}
                    aria-label={`Select order ${o.orderNumber}`}
                  />
                </td>
                <td className="px-4 py-2"><Link href={`/admin/orders/${o.id}`} className="font-semibold text-brand-600 hover:underline">#{o.orderNumber}</Link></td>
                <td className="px-4 py-2">{o.customerName}<div className="text-xs text-stone-500">{o.customerEmail}</div></td>
                <td className="px-4 py-2 text-stone-600 whitespace-nowrap">{o.date}</td>
                <td className="px-4 py-2">{o.qty}</td>
                <td className="px-4 py-2 text-stone-600">{o.payment}</td>
                <td className="px-4 py-2 text-right font-semibold">{o.total}</td>
                <td className="px-4 py-2"><StatusBadge s={o.status} /></td>
                <td className="px-4 py-2 text-xs font-mono text-stone-600">{o.pathaoConsignmentId || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <div className="p-8 text-center text-stone-500">No orders yet.</div>}
      </div>
    </>
  );
}

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:    { label: '🕐 Pending',    cls: 'bg-yellow-100 text-yellow-800' },
    dispatched: { label: '🚚 Dispatched', cls: 'bg-blue-100 text-blue-800' },
    received:   { label: '✅ Received',   cls: 'bg-green-100 text-green-800' },
    returned:   { label: '↩️ Returned',   cls: 'bg-red-100 text-red-800' },
  };
  const { label, cls } = map[s] ?? { label: s, cls: 'bg-stone-100 text-stone-600' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
}
