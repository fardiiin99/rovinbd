import { sha256, normalizePhoneBD } from './hash';
import { META_PIXEL_ID } from './pixel-config';

const PIXEL_ID = META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || '';
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_CODE || '';
const API_VERSION = 'v21.0';

type UserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  country?: string;
  externalId?: string;
  ip?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
};

type CapiEvent = {
  eventName: string;
  eventId: string;
  eventSourceUrl?: string;
  userData: UserData;
  customData?: Record<string, unknown>;
};

export function capiConfigured(): boolean {
  return Boolean(PIXEL_ID && ACCESS_TOKEN);
}

// Warn once per server process rather than on every event, so a missing
// config is visible in the logs without drowning them.
let warnedMissingConfig = false;

export async function sendCapiEvent(event: CapiEvent): Promise<void> {
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        `CAPI events are disabled: missing ${!PIXEL_ID ? 'NEXT_PUBLIC_META_PIXEL_ID' : 'META_CAPI_ACCESS_TOKEN'}. Skipping "${event.eventName}" and any further events.`,
      );
    }
    return;
  }

  const ud: Record<string, string | string[]> = {};
  if (event.userData.email) ud.em = sha256(event.userData.email);
  if (event.userData.phone) ud.ph = sha256(normalizePhoneBD(event.userData.phone));
  if (event.userData.firstName) ud.fn = sha256(event.userData.firstName);
  if (event.userData.lastName) ud.ln = sha256(event.userData.lastName);
  if (event.userData.city) ud.ct = sha256(event.userData.city.replace(/\s/g, ''));
  if (event.userData.state) ud.st = sha256(event.userData.state.replace(/\s/g, ''));
  if (event.userData.country) ud.country = sha256(event.userData.country);
  if (event.userData.externalId) ud.external_id = sha256(event.userData.externalId);
  if (event.userData.ip) ud.client_ip_address = event.userData.ip;
  if (event.userData.userAgent) ud.client_user_agent = event.userData.userAgent;
  if (event.userData.fbc) ud.fbc = event.userData.fbc;
  if (event.userData.fbp) ud.fbp = event.userData.fbp;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: event.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: 'website',
        event_source_url: event.eventSourceUrl,
        user_data: ud,
        custom_data: event.customData,
      },
    ],
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('CAPI event failed:', res.status, text);
    }
  } catch (err) {
    console.error('CAPI event error:', err);
  }
}

export function extractClientContext(req: Request): { ip: string; userAgent: string; fbc?: string; fbp?: string } {
  const headers = req.headers;
  const forwarded = headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim() || headers.get('x-real-ip') || '';
  const userAgent = headers.get('user-agent') || '';
  const cookie = headers.get('cookie') || '';
  const fbc = cookie.match(/_fbc=([^;]+)/)?.[1];
  const fbp = cookie.match(/_fbp=([^;]+)/)?.[1];
  return { ip, userAgent, fbc, fbp };
}
