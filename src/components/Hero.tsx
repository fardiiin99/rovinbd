'use client';

import { useEffect, useRef } from 'react';

const columns = [['street', 'fashion', 'style'], ['persona', 'bold', 'bandana']];
const characterUrl = '/images/rovin-character-bandana.png';

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => {
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      const progress = Math.min(1, Math.max(0, range > 0 ? -rect.top / range : 0));
      section.style.setProperty('--progress', String(progress));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <section ref={sectionRef} className="beyond-hero relative w-full" aria-label="Rovin">
      <div className="pointer-events-none absolute inset-0 z-10">
        <img src={characterUrl} alt="Character with electric-blue braids, silver beads, a black paisley forehead bandana, and a neon-green turtleneck looking upward" fetchPriority="high" className="absolute bottom-0 left-1/2 block w-auto max-w-none -translate-x-1/2" style={{ height: '115%', maxHeight: '115%', minHeight: '80%' }} />
      </div>
      <div className="beyond-overlay sticky top-0 h-screen w-full">
        <div className="absolute inset-0 flex items-start justify-center pt-[2vh] md:pt-[3vh]">
          <div className="beyond-title relative select-none">
            <span aria-hidden="true" className="beyond-title-layer beyond-title-blue">ROVIN</span>
            <span aria-hidden="true" className="beyond-title-layer beyond-title-orange">ROVIN</span>
            <span aria-hidden="true" className="beyond-title-layer beyond-title-green">ROVIN</span>
            <h1 className="relative text-white">ROVIN</h1>
          </div>
        </div>
        <div className="beyond-words pointer-events-none absolute inset-0 flex items-end justify-between px-[3vw] md:px-[6vw]">
          {columns.map((words, side) => (
            <div key={side} className={`beyond-word-column flex flex-col gap-1 md:gap-2 ${side === 1 ? 'items-end' : ''}`}>
              {words.map((word, index) => (
                <span key={word} className={`beyond-word select-none uppercase text-white/80 ${side === 1 ? 'text-right' : ''}`} style={{ transform: `translateX(calc(${(side === 0 ? -1 : 1) * (60 + index * 40)}px * var(--scale-factor) * (1 - var(--progress))))` }}>{word}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


