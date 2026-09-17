// Single source of truth for the Meta Pixel ID.
//
// The ID is hardcoded as a fallback, exactly as NEXT_PUBLIC_GA_ID is, because
// a missing env var previously disabled the pixel site-wide with no error
// anywhere. A pixel ID is not a secret — it ships in the page's HTML on every
// request — so there is nothing to protect by keeping it out of the repo. The
// Conversions API access token IS a secret and stays in the environment.
const FALLBACK_PIXEL_ID = '1278023470767983';

// NEXT_PUBLIC_META_PIXEL_ID is optional now: set it only to point a build at a
// different pixel (a staging or test pixel). NEXT_PUBLIC_* values are inlined
// at BUILD time, not read at runtime, so in Coolify an override must be marked
// as a build variable and the app redeployed to take effect.
const RAW_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

// Meta pixel IDs are all digits. Trim and strip stray quotes so a value pasted
// into the dashboard with a trailing space or newline still works, and reject
// anything that clearly isn't an ID (a placeholder, a URL, an empty string)
// rather than shipping a broken fbq('init').
function sanitizePixelId(raw: string | undefined): string {
  const value = (raw || '').trim().replace(/^["']|["']$/g, '');
  return /^\d{6,}$/.test(value) ? value : '';
}

const ENV_PIXEL_ID = sanitizePixelId(RAW_PIXEL_ID);

/** The pixel ID this build uses. Always populated thanks to the fallback. */
export const META_PIXEL_ID = ENV_PIXEL_ID || FALLBACK_PIXEL_ID;

/** True when a usable pixel ID is baked into this build. */
export const HAS_META_PIXEL = META_PIXEL_ID !== '';

/**
 * True when NEXT_PUBLIC_META_PIXEL_ID was set to something unusable, so the
 * hardcoded ID is being used instead. The override is broken, not the pixel.
 */
export const META_PIXEL_ID_INVALID = ENV_PIXEL_ID === '' && (RAW_PIXEL_ID || '').trim() !== '';

/** True when no valid override was supplied and the hardcoded ID is in use. */
export const META_PIXEL_ID_FROM_FALLBACK = ENV_PIXEL_ID === '';
