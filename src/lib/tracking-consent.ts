export const TRACKING_CONSENT_COOKIE = 'rovin_tracking';

// Tracking is on by default; only an explicit "deny" choice turns it off.
export function hasTrackingConsent(cookieHeader: string | null): boolean {
  return !cookieHeader?.split(';').some((cookie) => cookie.trim() === `${TRACKING_CONSENT_COOKIE}=deny`);
}
