import type { ReactNode } from 'react';

/**
 * Shell dokumen A4 printable (replika doc-page mockup Invoice Kwitansi).
 * Di layar: kertas putih di atas latar krem + tombol cetak. Saat print: A4 margin 0.6in.
 */
export function DocShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#ded4c0] py-8 print:min-h-0 print:bg-white print:py-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 0.6in; }
          .no-print { display: none !important; }
          .doc-sheet { box-shadow: none !important; margin: 0 !important; width: auto !important; padding: 0 !important; }
        }
      `}</style>
      <div className="no-print mx-auto mb-4 flex w-[794px] max-w-full items-center justify-between">
        <button onClick={() => history.back()} className="cursor-pointer text-[12px] font-semibold text-[oklch(0.42_0.08_172)] hover:underline">← Kembali</button>
        <button onClick={() => window.print()} className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep">
          Cetak / Simpan PDF
        </button>
      </div>
      <div className="doc-sheet mx-auto w-[794px] max-w-full bg-white p-[46px] shadow-float" style={{ borderTop: '6px solid #16211b' }}>
        {children}
      </div>
    </div>
  );
}

/** Kop surat PT Safar Barokah Wisata (identik di invoice & kwitansi mockup). */
export function DocHeader({ right }: { right: ReactNode }) {
  return (
    <div className="flex items-start justify-between border-b-2 border-[#16211b] pb-4">
      <div className="flex items-center gap-3">
        <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-gold font-display text-[22px] text-[#20180a]">S</div>
        <div>
          <div className="font-display text-[19px] leading-tight text-[#16211b]">PT Safar Barokah Wisata</div>
          <div className="mt-0.5 text-[9px] leading-relaxed text-muted-2">
            Jl. Warung Buncit Raya No. 42, Jakarta Selatan 12740<br />
            Izin PPIU Kemenag No. U-431 Tahun 2023 · Terdaftar SISKOPATUH<br />
            021-7900-345 · info@safarwisata.co.id
          </div>
        </div>
      </div>
      <div className="text-right">{right}</div>
    </div>
  );
}
