'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Customer } from '@/lib/db';
import { SEGMENT_LABELS, filterBySegment, type Segment } from '@/lib/segments';

const COST_PER_SMS = 0.45; // BDT, SSL Wireless masking rate

export default function BroadcastForm({ customers, smsReady }: { customers: Customer[]; smsReady: boolean }) {
  const [message, setMessage] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [testPhone, setTestPhone] = useState('');
  const [mode, setMode] = useState<'segment' | 'test'>('segment');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>('');

  const recipients = useMemo(() => filterBySegment(customers, segment).filter((c) => c.phone), [customers, segment]);
  const recipientCount = mode === 'test' ? 1 : recipients.length;
  const estimatedCost = (recipientCount * COST_PER_SMS).toFixed(2);
  const smsCount = Math.max(1, Math.ceil(message.length / 160));
  const totalCost = (recipientCount * COST_PER_SMS * smsCount).toFixed(2);

  // Reset result when user changes inputs
  useEffect(() => { setResult(''); }, [message, segment, mode, testPhone]);

  async function send() {
    if (!message.trim()) return;
    if (mode === 'test' && !testPhone.trim()) return;
    if (mode === 'segment' && recipientCount === 0) return;
    if (!confirm(mode === 'test'
      ? `Send test SMS to ${testPhone}?`
      : `Send to ${recipientCount} customers (${SEGMENT_LABELS[segment]})? Estimated cost ৳${totalCost}.`)) return;

    setSending(true);
    setResult('');
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          segment,
          testPhone: mode === 'test' ? testPhone : undefined,
        }),
      });
      if (res.status === 401) { window.location.href = '/admin/login'; return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setResult(`✓ Sent ${data.sent}/${data.total}${data.failed ? ` (${data.failed} failed)` : ''}${data.errors?.length ? `. First errors: ${data.errors.join('; ')}` : ''}`);
    } catch (e) {
      setResult(`Error: ${(e as Error).message}`);
    }
    setSending(false);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="font-display text-3xl font-bold">SMS Broadcast</h1>
        <p className="text-stone-600 mt-1">Send SMS to customer segments via Alpha SMS.</p>
      </div>

      {!smsReady && (
        <div className="card p-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          SMS not configured. Set <code>ALPHA_SMS_API_KEY</code> in the server environment before sending.
        </div>
      )}

      <div className="card p-5 space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('segment')}
            className={`px-3 py-1.5 rounded-md text-sm border ${mode === 'segment' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300'}`}
          >Segment broadcast</button>
          <button
            type="button"
            onClick={() => setMode('test')}
            className={`px-3 py-1.5 rounded-md text-sm border ${mode === 'test' ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300'}`}
          >Single test number</button>
        </div>

        {mode === 'segment' ? (
          <div>
            <label className="label">Audience</label>
            <select className="input" value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
              {(['all', 'vip', 'new', 'at_risk', 'repeat'] as Segment[]).map((s) => (
                <option key={s} value={s}>{SEGMENT_LABELS[s]} — {filterBySegment(customers, s).filter((c) => c.phone).length} with phone</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Test phone (BD)</label>
            <input className="input" placeholder="01XXXXXXXXX" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          </div>
        )}

        <div>
          <label className="label">Message</label>
          <textarea
            rows={5}
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Hi from Rovin! Use code ROVIN10 for 10% off your next order. Shop: www.rovinbd.com"
          />
          <div className="text-xs text-stone-500 mt-1">
            {message.length} chars · {smsCount} SMS segment{smsCount > 1 ? 's' : ''}
          </div>
        </div>

        <div className="border-t border-stone-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Recipients</span><span className="font-medium">{recipientCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Estimated cost</span><span className="font-medium">৳{totalCost}</span>
          </div>
        </div>

        <button
          onClick={send}
          disabled={sending || !smsReady || !message.trim() || (mode === 'segment' && recipientCount === 0) || (mode === 'test' && !testPhone.trim())}
          className="btn btn-primary w-full disabled:opacity-50"
        >
          {sending ? 'Sending…' : mode === 'test' ? 'Send test SMS' : `Send to ${recipientCount} customers`}
        </button>

        {result && (
          <div className={`text-sm ${result.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>{result}</div>
        )}
      </div>
    </div>
  );
}
