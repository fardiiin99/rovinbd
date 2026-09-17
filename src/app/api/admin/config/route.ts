import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/pg';
import { capiConfigured } from '@/lib/capi';
import { META_PIXEL_ID, META_PIXEL_ID_FROM_FALLBACK, META_PIXEL_ID_INVALID } from '@/lib/pixel-config';
import { GA4_MEASUREMENT_ID, GA4_MEASUREMENT_ID_FROM_FALLBACK } from '@/lib/ga4';

// GET /api/admin/config — which integrations this deploy actually has credentials
// for. Every integration in this app degrades silently when its env vars are
// missing (orders still save, but the Pathao consignment, the SMS and the
// Telegram alert just don't happen), so after a host migration this is the
// fastest way to find what didn't get carried over.
//
// Admin-only, and deliberately so: it reports whether AUTH_SECRET is still the
// hardcoded dev fallback, which must never be answerable by an anonymous
// caller. Values are never returned — only whether each one is present.

const has = (v: string | undefined) => Boolean(v && v.trim());

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const missing: string[] = [];
  const warnings: string[] = [];

  // --- Database ---
  const dbUrlSet = has(process.env.POSTGRES_URL) || has(process.env.DATABASE_URL);
  if (!dbUrlSet && !has(process.env.DB_PASSWORD)) missing.push('POSTGRES_URL');
  let dbReachable = false;
  let dbError: string | undefined;
  try {
    await sql.query('SELECT 1');
    dbReachable = true;
  } catch (e) {
    dbError = (e as Error).message;
  }
  if (!dbReachable) warnings.push('database unreachable');

  // --- Admin auth ---
  const authSecretSet = has(process.env.AUTH_SECRET);
  if (!authSecretSet) {
    warnings.push(
      'AUTH_SECRET is not set — admin sessions are signed with the hardcoded dev fallback, which anyone reading the repo can forge. Set it and redeploy.',
    );
  }
  if (!has(process.env.ADMIN_USERNAME) || !has(process.env.ADMIN_PASSWORD)) {
    missing.push('ADMIN_USERNAME/ADMIN_PASSWORD');
  }

  // --- Meta Pixel + Conversions API ---
  const capiTokenSet = has(process.env.META_CAPI_ACCESS_TOKEN);
  if (!capiTokenSet) missing.push('META_CAPI_ACCESS_TOKEN');
  if (has(process.env.META_CAPI_TEST_CODE)) {
    warnings.push('META_CAPI_TEST_CODE is set — CAPI events are going to Test Events and are excluded from reporting. Remove it when done testing.');
  }
  if (META_PIXEL_ID_INVALID) warnings.push('NEXT_PUBLIC_META_PIXEL_ID is set but unusable; the built-in pixel ID is being used.');

  // --- Supabase Storage (admin image uploads) ---
  const supabaseStorage = has(process.env.NEXT_PUBLIC_SUPABASE_URL) && has(process.env.SUPABASE_SERVICE_KEY);
  if (!supabaseStorage) {
    warnings.push('Supabase Storage is not configured; uploads fall back to storing bytes in Postgres.');
  }

  // --- Pathao delivery (all five required together) ---
  const pathaoVars = {
    PATHAO_CLIENT_ID: has(process.env.PATHAO_CLIENT_ID),
    PATHAO_CLIENT_SECRET: has(process.env.PATHAO_CLIENT_SECRET),
    PATHAO_USERNAME: has(process.env.PATHAO_USERNAME),
    PATHAO_PASSWORD: has(process.env.PATHAO_PASSWORD),
    PATHAO_STORE_ID: has(process.env.PATHAO_STORE_ID),
  };
  const pathaoMissing = Object.entries(pathaoVars).filter(([, ok]) => !ok).map(([k]) => k);
  missing.push(...pathaoMissing);

  // --- SMS + notifications ---
  const smsSet = has(process.env.ALPHA_SMS_API_KEY);
  if (!smsSet) missing.push('ALPHA_SMS_API_KEY');
  const telegramSet = has(process.env.TELEGRAM_BOT_TOKEN) && has(process.env.TELEGRAM_CHAT_ID);
  if (!telegramSet) missing.push('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID');

  // --- GA4 ---
  const ga4ServerSet = has(process.env.GA4_API_SECRET);
  if (!ga4ServerSet) missing.push('GA4_API_SECRET');

  return NextResponse.json({
    ok: missing.length === 0 && warnings.length === 0,
    missing,
    warnings,
    database: { configured: dbUrlSet || has(process.env.DB_PASSWORD), reachable: dbReachable, error: dbError },
    adminAuth: {
      credentialsSet: has(process.env.ADMIN_USERNAME) && has(process.env.ADMIN_PASSWORD),
      authSecretSet,
      usingDevFallbackSecret: !authSecretSet,
    },
    metaPixel: {
      pixelId: META_PIXEL_ID,
      source: META_PIXEL_ID_FROM_FALLBACK ? 'built-in' : 'env',
      browserPixelActive: true,
    },
    metaCapi: {
      accessTokenSet: capiTokenSet,
      ready: capiConfigured(),
      testModeActive: has(process.env.META_CAPI_TEST_CODE),
    },
    uploads: {
      target: supabaseStorage ? 'supabase-storage' : 'postgres-fallback',
      supabaseUrlSet: has(process.env.NEXT_PUBLIC_SUPABASE_URL),
      serviceKeySet: has(process.env.SUPABASE_SERVICE_KEY),
    },
    pathao: {
      ready: pathaoMissing.length === 0,
      missing: pathaoMissing,
      environment: process.env.PATHAO_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
    },
    sms: {
      ready: smsSet,
      senderIdSet: has(process.env.ALPHA_SMS_SENDER_ID),
      adminCopyPhoneSet: has(process.env.ADMIN_SMS_PHONE),
    },
    telegram: { ready: telegramSet },
    ga4: {
      measurementId: GA4_MEASUREMENT_ID,
      measurementIdSource: GA4_MEASUREMENT_ID_FROM_FALLBACK ? 'built-in' : 'env',
      serverSideReady: ga4ServerSet,
    },
  });
}
