import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { BackButton } from '../components/BackButton';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@safar.co.id');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate((location.state as { from?: { pathname: string } })?.from?.pathname ?? '/', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
        'Tidak dapat terhubung ke server';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream p-6">
      <div className="flex w-[820px] max-w-full overflow-hidden rounded-[16px] shadow-float">
        {/* Panel brand gelap */}
        <div
          className="hidden w-[340px] flex-none flex-col justify-between p-8 text-forest-text md:flex"
          style={{ background: 'linear-gradient(160deg,#16211b,#1b2a20)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-gold font-display text-[22px] text-[#20180a]">
              S
            </div>
            <div>
              <div className="font-display text-[21px] leading-none tracking-[0.5px]">Safar</div>
              <div className="mt-1 text-[10.5px] uppercase tracking-[1px] text-forest-muted">
                Manajemen Umrah & Haji
              </div>
            </div>
          </div>
          <div>
            <div className="font-display text-[24px] leading-snug">
              Sistem Informasi Travel Haji & Umrah Terintegrasi
            </div>
            <div className="mt-3 text-[12px] leading-relaxed text-forest-muted">
              Pendaftaran jamaah, pembayaran, operasional, hingga akuntansi PSAK 72 — dalam satu sistem.
            </div>
          </div>
          <div className="text-[10px] text-forest-muted">
            PT Safar Barokah Wisata · Izin PPIU Kemenag No. U-431 Tahun 2023
          </div>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="flex-1 bg-card p-9">
          <div className="flex items-start justify-between">
            <div className="font-display text-[24px] text-ink-strong">Masuk</div>
            <BackButton fallback="/daftar" />
          </div>
          <div className="mt-1 text-[12.5px] text-muted-2">Gunakan akun yang terdaftar pada sistem.</div>

          <div className="mt-7">
            <label className="lbl" htmlFor="email">Email</label>
            <input id="email" type="email" className="fld" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          <div className="mt-4">
            <label className="lbl" htmlFor="password">Password</label>
            <input id="password" type="password" className="fld" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>

          {error && (
            <div className="mt-4 rounded-[9px] border border-[oklch(0.85_0.08_30)] bg-danger-bg px-3.5 py-2.5 text-[12px] font-medium text-danger-deep">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full cursor-pointer rounded-[9px] bg-primary px-4 py-3 text-[13.5px] font-semibold text-white hover:bg-primary-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Memproses…' : 'Masuk'}
          </button>

          <div className="mt-6 rounded-[9px] bg-panel px-3.5 py-3 text-[11px] leading-relaxed text-muted-2">
            <b>Akun demo</b> (password: <span className="font-mono">safar123</span>): admin@safar.co.id ·
            keuangan@safar.co.id · ops@safar.co.id · marketing@safar.co.id · pimpinan@safar.co.id
          </div>
          <div className="mt-4 text-center text-[12px]">
            <a href="/daftar" className="font-semibold text-primary hover:underline">Daftar sebagai jamaah baru →</a>
          </div>
        </form>
      </div>
    </div>
  );
}
