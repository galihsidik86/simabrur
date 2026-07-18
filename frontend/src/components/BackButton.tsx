import { useNavigate } from 'react-router-dom';

/**
 * Tombol kembali: mundur di riwayat browser; bila tidak ada riwayat
 * (halaman dibuka langsung), menuju rute fallback.
 */
export function BackButton({ fallback = '/', label = '← Kembali' }: { fallback?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))}
      className="cursor-pointer rounded-[9px] border border-line-2 bg-white/70 px-3 py-1.5 text-[12px] font-semibold text-muted hover:bg-white"
    >
      {label}
    </button>
  );
}
