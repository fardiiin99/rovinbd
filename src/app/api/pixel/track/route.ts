import { NextResponse } from 'next/server';
import { sendCapiEvent, extractClientContext, capiConfigured } from '@/lib/capi';
import {
  META_PIXEL_ID,
  HAS_META_PIXEL,
  META_PIXEL_ID_INVALID,
  META_PIXEL_ID_FROM_FALLBACK,
} from '@/lib/pixel-config';
import { cityToDivision } from '@/lib/bd-divisions';

type IncomingBody = {
  eventName: string;
  eventId: string;
  customData?: Record<string, unknown>;
  userData?: {
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
  sourceUrl?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IncomingBody;
    if (!body?.eventName || !body?.eventId) {
      return NextResponse.json({ error: 'Missing eventName or eventId' }, { status: 400 });
    }

    const ctx = extractClientContext(req);

    let firstName = body.userData?.firstName;
    let lastName = body.userData?.lastName;
    if (body.userData?.fullName && !firstName) {
      const parts = body.userData.fullName.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(' ') || undefined;
    }

    const city = body.userData?.city;
    const state = body.userData?.state || (city ? cityToDivision(city) : undefined);

    await sendCapiEvent({
      eventName: body.eventName,
      eventId: body.eventId,
      eventSourceUrl: body.sourceUrl,
      userData: {
        email: body.userData?.email,
        phone: body.userData?.phone,
        firstName,
        lastName,
        city,
        state,
        country: body.userData?.country || 'bd',
        externalId: body.userData?.externalId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        fbc: ctx.fbc,
        fbp: ctx.fbp,
      },
      customData: body.customData,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET /api/pixel/track — config check for debugging a dead pixel.
// Reports only whether things are configured; never echoes the access token.
export async function GET() {
  return NextResponse.json({
    pixelId: HAS_META_PIXEL ? META_PIXEL_ID : null,
    pixelIdConfigured: HAS_META_PIXEL,
    pixelIdSource: META_PIXEL_ID_FROM_FALLBACK ? 'built-in' : 'env',
    envOverrideInvalid: META_PIXEL_ID_INVALID,
    capiAccessTokenConfigured: Boolean(process.env.META_CAPI_ACCESS_TOKEN),
    capiReady: capiConfigured(),
    note: META_PIXEL_ID_INVALID
      ? 'NEXT_PUBLIC_META_PIXEL_ID is set but is not a valid numeric pixel ID; it was ignored in favour of the built-in ID.'
      : undefined,
  });
}
