import type { Metadata } from 'next';
import Hero from '@/components/Hero';
import Marquee from '@/components/Marquee';
import './beyond.css';

export const metadata: Metadata = {
  title: 'ROVIN | Bandanas for Your Everyday Style',
  description: 'Wear your own style with ROVIN bandanas. Bold prints for everyday looks. Tie it your way at rovinbd.com.',
};

export default function Home() {
  return <main className="beyond-home"><Hero /><Marquee /></main>;
}
