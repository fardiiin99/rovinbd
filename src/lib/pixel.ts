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

// Advanced-matching fields in the pixel's own key names (fbq hashes them).
export type PixelMatchData = {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  ct?: string;
  st?: string;
  country?: string;
  external_id?: string;
};

const MATCH_KEY = 'rovin_am';

function readCookie(name: string): string | undefined {
  return document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
}

// What the layout's init script gave the pixel: the saved buyer details, or
// just the anonymous visitor ID.
function storedMatchData(): PixelMatchData {
  let am: PixelMatchData = {};
  try { am = JSON.parse(localStorage.getItem(MATCH_KEY) || '{}') || {}; } catch { am = {}; }
  if (!am.external_id) am.external_id = readCookie('rovin_vid');
  return am;
}

// Called once a customer has ordered: re-init the pixel with their details so
// this and every later event (including on future visits) is matched to them.
export function setPixelMatchData(am: PixelMatchData, pixelId: string) {
  try { localStorage.setItem(MATCH_KEY, JSON.stringify(am)); } catch { /* private mode */ }
  const w = window as unknown as { fbq?: (...args: unknown[]) => void };
  w.fbq?.('init', pixelId, am);
}

// Fire the same event server-side via Conversions API for dedup + iOS recovery.
// eventId MUST match the eventID passed to fbqTrack for deduplication.
export function mirrorToCapi(
  eventName: string,
  eventId: string,
  customData?: FbqParams,
  userData?: ServerUserData,
) {
  if (typeof window === 'undefined') return;
  // A build with no pixel ID at all can't have the server send the event
  // either, so skip the request. With the ID hardcoded this is normally true,
  // and the POST is a no-op server-side until META_CAPI_ACCESS_TOKEN is set.
  if (!HAS_META_PIXEL) return;
  try {
    fetch('/api/pixel/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventName,
        eventId,
        customData,
        userData: userData ?? toServerUserData(storedMatchData()),
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

function toServerUserData(am: PixelMatchData): ServerUserData {
  return {
    email: am.em, phone: am.ph, firstName: am.fn, lastName: am.ln,
    city: am.ct, state: am.st, country: am.country, externalId: am.external_id,
  };
}
