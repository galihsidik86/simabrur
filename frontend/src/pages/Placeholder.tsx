export function Placeholder({ module: mod, phase }: { module: string; phase: number }) {
  return (
    <div className="rounded-card border border-line bg-card p-8 shadow-card">
      <div className="font-display text-[19px] text-ink-strong">{mod}</div>
      <div className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted-2">
        Modul ini diimplementasikan pada <b>Fase {phase}</b> sesuai PLAN.md. Fondasi (autentikasi, RBAC, design
        token, dan shell aplikasi) sudah berjalan — konten modul menyusul fase demi fase.
      </div>
      <span className="mt-4 inline-block rounded-pill bg-thead px-3 py-1 text-[10.5px] font-semibold text-muted-2">
        Menunggu Fase {phase}
      </span>
    </div>
  );
}
