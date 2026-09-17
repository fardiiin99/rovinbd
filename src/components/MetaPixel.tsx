'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { fbqTrack, mirrorToCapi, newEventId } from '@/lib/pixel';
import { HAS_META_PIXEL, META_PIXEL_ID_INVALID } from '@/lib/pixel-config';

export default function MetaPixel() {
  const pathname = usePathname();

  // Fire PageView on first load AND every client-side route change.
  // Each gets a fresh event_id so the browser pixel and the server CAPI
  // event deduplicate. The inline base code only runs fbq('init') — it no
  // longer auto-fires PageView, so there's no double counting.
  useEffect(() => {
    if (META_PIXEL_ID_INVALID) {
      // The override is unusable, so the hardcoded ID is in play. Surface it —
      // otherwise a typo'd env var silently sends events to the wrong place.
      console.warn(
        '[MetaPixel] NEXT_PUBLIC_META_PIXEL_ID is set but is not a valid numeric pixel ID — ignoring it and using the built-in pixel ID.',
      );
    }
    if (!HAS_META_PIXEL) return;
    const eventId = newEventId('pv');
    fbqTrack('PageView', undefined, { eventID: eventId });
    mirrorToCapi('PageView', eventId);
  }, [pathname]);

  return null;
}
