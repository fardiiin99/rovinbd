export const TRACKING_CONSENT_COOKIE = 'rovin_tracking';

export function hasTrackingConsent(cookieHeader: string | null): boolean {
  return Boolean(cookieHeader?.split(';').some((cookie) => cookie.trim() === `${TRACKING_CONSENT_COOKIE}=allow`));
}
