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
    if (!HAS_META_PIXEL) {
      // Make this silent failure visible: without the ID the base code is
      // never rendered, so PageView/AddToCart/Purchase all quietly no-op.
      console.warn(
        META_PIXEL_ID_INVALID
          ? '[MetaPixel] NEXT_PUBLIC_META_PIXEL_ID is set but is not a valid numeric pixel ID — pixel disabled.'
          : '[MetaPixel] NEXT_PUBLIC_META_PIXEL_ID is not set in this build — pixel disabled. Set it in the hosting env vars and redeploy.',
      );
      return;
    }
    const eventId = newEventId('pv');
    fbqTrack('PageView', undefined, { eventID: eventId });
    mirrorToCapi('PageView', eventId);
  }, [pathname]);

  return null;
}
