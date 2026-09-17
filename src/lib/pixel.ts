// Client-side Meta Pixel helper. Safe no-op if the pixel isn't loaded.
import { HAS_META_PIXEL } from './pixel-config';

type FbqParams = Record<string, unknown>;

export function fbqTrack(event: string, params?: FbqParams, options?: { eventID?: string }) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { fbq?: (...args: unknown[]) => void };
  if (!w.fbq) return;
  if (options) w.fbq('track', event, params || {}, options);
  else w.fbq('track', event, params || {});
}

export function fbqTrackCustom(event: string, params?: FbqParams, options?: { eventID?: string }) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { fbq?: (...args: unknown[]) => void };
  if (!w.fbq) return;
  if (options) w.fbq('trackCustom', event, params || {}, options);
  else w.fbq('trackCustom', event, params || {});
}

export const PIXEL_CURRENCY = 'BDT';

type ServerUserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  city?: string;
  state?: string;
  country?: string;
  externalId?: string;
};

// Fire the same event server-side via Conversions API for dedup + iOS recovery.
// eventId MUST match the eventID passed to fbqTrack for deduplication.
export function mirrorToCapi(
  eventName: string,
  eventId: string,
  customData?: FbqParams,
  userData?: ServerUserData,
) {
  if (typeof window === 'undefined') return;
  // No pixel ID in this build means the server can't send the event either,
  // so skip the request instead of POSTing on every page view.
  if (!HAS_META_PIXEL) return;
  try {
    fetch('/api/pixel/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        eventId,
        customData,
        userData,
        sourceUrl: window.location.href,
      }),
      keepalive: true,
    });
  } catch {
    // best-effort; ignore network errors
  }
}

// Generate a stable event ID for use on both browser pixel and server CAPI.
export function newEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
