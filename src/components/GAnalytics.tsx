'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-Y3XL9ENBXH';

export default function GAnalytics() {
  const pathname = usePathname();
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (!GA_ID) return;
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    if (w.gtag) w.gtag('event', 'page_view', { page_path: pathname });
  }, [pathname]);

  return null;
}
