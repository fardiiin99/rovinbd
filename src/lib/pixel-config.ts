// Single source of truth for the Meta Pixel ID.
//
// IMPORTANT: NEXT_PUBLIC_* values are inlined at BUILD time, not read at
// runtime. Adding NEXT_PUBLIC_META_PIXEL_ID in Vercel therefore does nothing
// until the project is redeployed.
const RAW_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

// Meta pixel IDs are all digits. Trim and strip stray quotes so a value pasted
// into the dashboard with a trailing space or newline still works, and reject
// anything that clearly isn't an ID (a placeholder, a URL, an empty string)
// instead of shipping a broken fbq('init').
function sanitizePixelId(raw: string | undefined): string {
  const value = (raw || '').trim().replace(/^["']|["']$/g, '');
  return /^\d{6,}$/.test(value) ? value : '';
}

export const META_PIXEL_ID = sanitizePixelId(RAW_PIXEL_ID);

/** True when a usable pixel ID is baked into this build. */
export const HAS_META_PIXEL = META_PIXEL_ID !== '';

/** True when the env var was set but isn't a valid pixel ID — a config typo. */
export const META_PIXEL_ID_INVALID = !HAS_META_PIXEL && (RAW_PIXEL_ID || '').trim() !== '';
