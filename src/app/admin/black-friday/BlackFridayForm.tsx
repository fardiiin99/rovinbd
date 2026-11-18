'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BLACK_FRIDAY_TIERS, isCampaignActive, dhakaInputToEpoch, epochToDhakaInput,
  type BlackFridayCampaign,
} from '@/lib/pricing';

function statusOf(c: BlackFridayCampaign, now: number): { text: string; tone: string } {
  if (!c.enabled) return { text: 'Off — regular prices, no banner.', tone: 'bg-stone-100 text-stone-700' };
  if (isCampaignActive(c, now)) return { text: 'Live now — banner showing, discount applied at checkout.', tone: 'bg-green-100 text-green-800' };
  if (c.startsAt != null && now < c.startsAt) return { text: 'Scheduled — starts automatically at the start time.', tone: 'bg-amber-100 text-amber-800' };
  return { text: 'Ended — the end time has passed.', tone: 'bg-stone-100 text-stone-700' };
}

export default function BlackFridayForm({ initial }: { initial: BlackFridayCampaign }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [start, setStart] = useState(epochToDhakaInput(initial.startsAt));
  const [end, setEnd] = useState(epochToDhakaInput(initial.endsAt));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const status = statusOf(saved, Date.now());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    const startsAt = start ? dhakaInputToEpoch(start) : null;
    const endsAt = end ? dhakaInputToEpoch(end) : null;
    if ((start && startsAt == null) || (end && endsAt == null)) {
      setError('Please enter complete dates and times.');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/black-friday', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, startsAt, endsAt }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error || 'Could not save.');
      return;
    }
    setSaved(data);
    setMessage('Saved. The storefront uses this immediately.');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className={`rounded-md px-4 py-3 text-sm font-medium ${status.tone}`}>{status.text}</div>

      <div className="card p-5 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" className="h-5 w-5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="font-semibold">Sale switched on</span>
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Starts (Dhaka time, optional)</label>
            <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Ends (Dhaka time, optional)</label>
            <input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-stone-500">
          Leave both empty to run the sale for as long as the switch is on. With dates set, the switch must
          also be on; the sale then starts and ends by itself.
        </p>
        {(start || end) && (
          <button type="button" className="text-sm text-brand-600 hover:underline" onClick={() => { setStart(''); setEnd(''); }}>
            Clear dates
          </button>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold mb-2">Discount tiers (items in cart)</h2>
        <ul className="text-sm text-stone-700 space-y-1">
          <li>1 item — regular price</li>
          {[...BLACK_FRIDAY_TIERS].reverse().map((t) => (
            <li key={t.minItems}>{t.minItems === 5 ? '5 or more items' : `${t.minItems} items`} — {t.percent}% off</li>
          ))}
        </ul>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {message && <div className="text-sm text-green-700">{message}</div>}
      <button disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
