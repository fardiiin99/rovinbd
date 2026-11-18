'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import LogoutButton from './LogoutButton';

const links = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/finance', label: 'Finance' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/broadcast', label: 'SMS Broadcast' },
  { href: '/admin/banners', label: 'Banners' },
  { href: '/admin/category-tiles', label: 'Category Tiles' },
  { href: '/admin/gallery', label: 'Gallery' },
  { href: '/admin/black-friday', label: 'Black Friday' },
  { href: '/admin/content', label: 'Site Content' },
];

export default function AdminNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const navBody = (
    <>
      <div className="p-5 border-b border-stone-800">
        <div className="font-display text-xl font-bold text-brand-500">Rovin Admin</div>
        <div className="text-xs text-stone-400 mt-1">Bandana Shop</div>
      </div>
      <nav className="p-3 flex-1 space-y-1 text-sm overflow-y-auto">
        {links.map((l) => {
          const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 rounded hover:bg-stone-800 ${active ? 'bg-stone-800 text-brand-400' : ''}`}
            >
              {l.label}
            </Link>
          );
        })}
        <Link href="/" onClick={() => setOpen(false)} className="block px-3 py-2 rounded hover:bg-stone-800 text-stone-400">← View Store</Link>
      </nav>
      <div className="p-3 border-t border-stone-800"><LogoutButton /></div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-40 flex items-center justify-between bg-stone-900 text-stone-100 px-4 h-14">
        <div className="font-display text-lg font-bold text-brand-500">Rovin Admin</div>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 rounded hover:bg-stone-800">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 bg-stone-900 text-stone-100 flex-col min-h-screen sticky top-0">
        {navBody}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-stone-900 text-stone-100 flex flex-col min-h-screen">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute top-4 right-3 p-1 text-stone-300 hover:text-white">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            {navBody}
          </aside>
        </div>
      )}
    </>
  );
}
