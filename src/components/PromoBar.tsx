'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Site-wide Black Friday strip. The root layout passes the same campaign state
// that checkout prices with, so the banner and the discount always agree.
export default function PromoBar({ active }: { active: boolean }) {
  const pathname = usePathname();
  if (!active || pathname?.startsWith('/admin')) return null;
  return (
    <Link
      href="/shop"
      className="block bg-black px-4 py-2 text-center text-xs sm:text-sm font-semibold tracking-[0.2em] text-white hover:bg-stone-800"
    >
      BLACK FRIDAY · UP TO 50% OFF
    </Link>
  );
}
