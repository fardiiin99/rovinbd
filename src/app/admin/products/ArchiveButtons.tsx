'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: object) {
  const res = await fetch('/api/admin/products/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.status === 401) { window.location.href = '/admin/login'; return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not update');
  return data as { updated: number };
}

// One product: "Archive" in the active list, "Restore" in the archived list.
export function ArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await post({ id, archived: !archived }); router.refresh(); }
    catch (e) { alert((e as Error).message); }
    setBusy(false);
  };
  return archived ? (
    <button onClick={run} disabled={busy} className="btn btn-primary text-xs px-3 py-1 disabled:opacity-50">
      {busy ? 'Restoring…' : 'Restore'}
    </button>
  ) : (
    <button onClick={run} disabled={busy} className="text-stone-600 hover:underline disabled:opacity-50">
      {busy ? 'Archiving…' : 'Archive'}
    </button>
  );
}

export function ArchiveSoldOutButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const run = async () => {
    if (!confirm(`Archive ${count} sold-out product(s)? They disappear from the shop until you restore them.`)) return;
    setBusy(true);
    setResult('');
    try {
      const data = await post({ allSoldOut: true });
      if (data) { setResult(`✓ Archived ${data.updated} product(s).`); router.refresh(); }
    } catch (e) { setResult(`Error: ${(e as Error).message}`); }
    setBusy(false);
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={run} disabled={busy || count === 0} className="btn btn-outline text-sm disabled:opacity-50">
        {busy ? 'Archiving…' : `Archive all sold-out (${count})`}
      </button>
      {result && <div className={`text-xs ${result.startsWith('Error') ? 'text-red-600' : 'text-stone-600'}`}>{result}</div>}
    </div>
  );
}
