'use client';

import { useEffect, useRef } from 'react';

const columns = [['street', 'fashion', 'style'], ['personal', 'bold', 'bandana']];
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
      <div className="beyond-title-wrap absolute inset-x-0 top-0 z-[5] flex flex-col items-center">
        <div className="beyond-title relative select-none">
          <span aria-hidden="true" className="beyond-title-layer beyond-title-blue">ROVIN</span>
          <span aria-hidden="true" className="beyond-title-layer beyond-title-orange">ROVIN</span>
          <span aria-hidden="true" className="beyond-title-layer beyond-title-green">ROVIN</span>
          <h1 className="relative text-white">ROVIN</h1>
        </div>
        <p className="beyond-tagline md:hidden">Street · Fashion · Bold bandanas</p>
      </div>

      <img
        src={characterUrl}
        alt="Character with electric-blue braids, silver beads, a black paisley forehead bandana, and a neon-green turtleneck looking upward"
        fetchPriority="high"
        className="beyond-character pointer-events-none absolute left-1/2 z-10 block w-auto max-w-none -translate-x-1/2"
      />

      <div className="beyond-words pointer-events-none absolute inset-x-0 z-20 hidden md:flex items-end justify-between px-[5vw]">
        {columns.map((words, side) => (
          <div key={side} className={`beyond-word-column flex flex-col gap-1 ${side === 1 ? 'items-end' : ''}`}>
            {words.map((word, wordIndex) => (
              <span key={word} className={`beyond-word select-none uppercase ${side === 1 ? 'text-right' : ''}`} aria-label={word}>
                {word.split('').map((letter, letterIndex) => (
                  <span
                    key={letterIndex}
                    aria-hidden="true"
                    className="beyond-ripple"
                    style={{ animationDelay: `${(wordIndex * 3 + letterIndex) * 90}ms` }}
                  >
                    {letter}
                  </span>
                ))}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
