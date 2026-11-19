import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || 'dev-secret-change-me-please-this-is-long-enough');

function captureFbclid(req: NextRequest, res: NextResponse) {
  const fbclid = req.nextUrl.searchParams.get('fbclid');
  if (!fbclid) return;
  if (req.cookies.get('_fbc')) return;
  // Meta format: fb.{subdomainIndex}.{timestamp}.{fbclid}
  const fbc = `fb.1.${Date.now()}.${fbclid}`;
  res.cookies.set('_fbc', fbc, {
    maxAge: 60 * 60 * 24 * 90, // 90 days, matches Pixel default
    path: '/',
    sameSite: 'lax',
  });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Admin auth gate
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login' || pathname.startsWith('/api/admin/login')) return NextResponse.next();
    const token = req.cookies.get('admin_session')?.value;
    if (!token) return NextResponse.redirect(new URL('/admin/login', req.url));
    try {
      await jwtVerify(token, SECRET);
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
  }

  // fbclid → _fbc fallback for ad-blocked Pixel
  const res = NextResponse.next();
  captureFbclid(req, res);
  return res;
}

export const config = {
  matcher: [
    // Run on all routes except static assets and Next internals. The YouTube upload is
    // skipped too: Next.js cuts request bodies passing through middleware at 10 MB, and
    // exported Shorts are bigger. That route checks the admin session itself.
    '/((?!_next/static|_next/image|favicon.ico|api/admin/youtube/upload|.*\\.(?:jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2)$).*)',
  ],
};
