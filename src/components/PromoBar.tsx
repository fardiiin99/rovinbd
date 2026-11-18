'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BLACK_FRIDAY_TIERS } from '@/lib/pricing';

// Site-wide Black Friday ticker. The root layout passes the same campaign state
// that checkout prices with, so the banner and the discount always agree.
const MESSAGES = [
  'BLACK FRIDAY SALE',
  ...[...BLACK_FRIDAY_TIERS].reverse().map((t) =>
    t.minItems === 5 ? `BUY 5 OR MORE · ${t.percent}% OFF` : `BUY ${t.minItems} · ${t.percent}% OFF`,
  ),
  'MIX ANY PRODUCTS',
  'NO CODE NEEDED',
  'DISCOUNT APPLIED AUTOMATICALLY AT CHECKOUT',
  'SHOP NOW →',
];

function Run({ hidden }: { hidden?: boolean }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {MESSAGES.map((m, i) => (
        <span key={i} className="flex items-center">
          <span className="px-5 sm:px-7">{m}</span>
          <span className="text-amber-300">✦</span>
        </span>
      ))}
    </span>
  );
}

export default function PromoBar({ active }: { active: boolean }) {
  const pathname = usePathname();
  if (!active || pathname?.startsWith('/admin')) return null;
  return (
    <Link
      href="/shop"
      aria-label="Black Friday sale: buy 2 get 10% off, 3 get 20% off, 4 get 30% off, 5 or more get 50% off. No code needed. Shop now."
      className="promo-ticker block overflow-hidden bg-black py-2 text-xs sm:text-sm font-semibold tracking-[0.18em] text-white"
    >
      <span className="promo-ticker-track flex w-max whitespace-nowrap">
        <Run />
        <Run hidden />
      </span>
    </Link>
  );
}
