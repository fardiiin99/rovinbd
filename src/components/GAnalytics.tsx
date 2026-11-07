'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-Y3XL9ENBXH';

export default function GAnalytics() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!GA_ID) return;
    if (lastPath.current === pathname) return;
    if (pathname.startsWith('/admin')) {
      lastPath.current = pathname;
      return;
    }
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    if (!w.gtag) return;
    const pageLocation = window.location.href;
    w.gtag('event', 'page_view', { page_path: pathname, page_location: pageLocation, page_title: document.title });
    lastPath.current = pathname;
  }, [pathname]);

  return null;
}
