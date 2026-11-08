'use client';

import { useState } from 'react';
import { TRACKING_CONSENT_COOKIE } from '@/lib/tracking-consent';

export default function TrackingPreferences({ hasChoice }: { hasChoice: boolean }) {
  const [open, setOpen] = useState(!hasChoice);

  function save(choice: 'allow' | 'deny') {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${TRACKING_CONSENT_COOKIE}=${choice}; Path=/; Max-Age=15552000; SameSite=Lax${secure}`;
    window.location.reload();
  }

  return (
    <aside className="fixed bottom-3 left-3 z-40 max-w-sm rounded-lg border bg-white p-3 text-sm text-stone-900 shadow-md" aria-label="Tracking preferences">
      {open ? (
        <>
          <p>We use Google Analytics and Meta to measure visits, purchases, and ads. You can turn this off.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-1" onClick={() => save('deny')}>Turn off tracking</button>
            <button type="button" className="rounded border px-3 py-1" onClick={() => save('allow')}>OK</button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>Tracking preferences</button>
      )}
    </aside>
  );
}
