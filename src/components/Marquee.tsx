const words = 'ROVIN BANDANAS · BOLD PRINTS · EVERYDAY STYLE · TIE IT YOUR WAY · ROVINBD.COM · ';

export default function Marquee() {
  return (
    <section className="w-full overflow-hidden bg-white py-6 md:py-8" aria-label="ROVIN bandanas. Bold prints. Everyday style. Tie it your way. Rovinbd.com.">
      <div className="marquee-track flex whitespace-nowrap" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span key={index} className="beyond-marquee-copy shrink-0 select-none uppercase">{words}</span>)}
      </div>
    </section>
  );
}

