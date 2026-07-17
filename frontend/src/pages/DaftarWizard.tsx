import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtShort, fmtFull, fmtDate, age } from '../utils/format';

/* ============ Tipe & konstanta (struktur data persis mockup Pendaftaran Jamaah) ============ */

interface PaketRow {
  id: string; code: string; name: string; type: 'umrah' | 'haji'; category: string;
  durationDays: number; basePrice: number; tripleUpcharge: number; doubleUpcharge: number;
  hotel: string | null; airline: string | null; isActive: boolean;
  departure: { id: string; date: string; quota: number; seatsTaken: number; seatsLeft: number; status: string } | null;
}

const STEPS = ['Paket', 'Data Diri', 'Dokumen', 'Kamar', 'Pembayaran', 'Konfirmasi'];

const DOCS = [
  { id: 'KTP', name: 'KTP', hint: 'Kartu Tanda Penduduk' },
  { id: 'KK', name: 'Kartu Keluarga', hint: 'KK terbaru' },
  { id: 'PPR', name: 'Paspor', hint: 'Halaman identitas, min. berlaku 7 bulan' },
  { id: 'FTO', name: 'Pas Foto 4×6', hint: 'Latar putih, 80% wajah' },
  { id: 'NKH', name: 'Buku Nikah', hint: 'Bila bepergian dengan pasangan (opsional)' },
  { id: 'VKS', name: 'Kartu Vaksin Meningitis', hint: 'Sertifikat ICV' }
] as const;

const ROOMS = [
  { id: 'quad', label: 'Quad', desc: '4 orang/kamar' },
  { id: 'triple', label: 'Triple', desc: '3 orang/kamar' },
  { id: 'double', label: 'Double', desc: '2 orang/kamar' }
] as const;

const DP_AMOUNT = 5_000_000;
const SCHEMES = [
  { id: 'dp', label: 'Uang Muka (DP)', desc: 'Bayar DP, sisanya sebelum keberangkatan' },
  { id: 'cicil', label: 'Cicilan 6× Termin', desc: 'DP + 5 termin bulanan otomatis' },
  { id: 'lunas', label: 'Lunas', desc: 'Bayar penuh sekarang' }
] as const;

const METHODS = [
  { id: 'va', label: 'Transfer / VA', desc: 'BSI Virtual Account' },
  { id: 'card', label: 'Kartu Kredit', desc: 'Visa / Mastercard' },
  { id: 'manual', label: 'Transfer Manual', desc: 'Konfirmasi bukti bayar' }
] as const;

const EMPTY_FORM = {
  nama: '', nik: '', hp: '', tmpt: '', tgl: '', gender: 'L' as 'L' | 'P', email: '', alamat: '',
  darurat: '', daruratHp: '', paspor: '', pIssue: '', pExpiry: '', mahram: '', mahramRel: ''
};

/* ============ Komponen ============ */

export function DaftarWizard() {
  const [step, setStep] = useState(1);
  const [pkg, setPkg] = useState<PaketRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [room, setRoom] = useState<'quad' | 'triple' | 'double'>('quad');
  const [scheme, setScheme] = useState<'dp' | 'cicil' | 'lunas'>('dp');
  const [method, setMethod] = useState<'va' | 'card' | 'manual'>('va');
  const [referral, setReferral] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ regNumber: string; docsUploaded: number } | null>(null);

  const { data: pakets } = useQuery({
    queryKey: ['public-packages'],
    queryFn: async () => (await api.get('/packages')).data.data as PaketRow[]
  });

  const { data: passportCheck } = useQuery({
    queryKey: ['passport-check', pkg?.departure?.id, form.pExpiry],
    enabled: Boolean(pkg?.departure && /^\d{4}-\d{2}-\d{2}$/.test(form.pExpiry)),
    queryFn: async () =>
      (await api.get('/registrations/passport-check', { params: { departureId: pkg!.departure!.id, expiry: form.pExpiry } })).data
        .data as { valid: boolean; minValidUntil: string }
  });

  const roomUp = pkg ? (room === 'triple' ? pkg.tripleUpcharge : room === 'double' ? pkg.doubleUpcharge : 0) : 0;
  const total = (pkg?.basePrice ?? 0) + roomUp;
  const dueNow = scheme === 'lunas' ? total : DP_AMOUNT;

  const mahramWajib = useMemo(
    () => form.gender === 'P' && form.tgl && pkg?.departure && age(form.tgl, pkg.departure.date) < 45,
    [form.gender, form.tgl, pkg]
  );

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const canProceed = useMemo(() => {
    if (step === 1) return Boolean(pkg?.departure && pkg.departure.seatsLeft > 0);
    if (step === 2)
      return Boolean(form.nama.length >= 3 && /^\d{16}$/.test(form.nik) && form.hp.length >= 8 && form.tmpt && form.tgl && form.alamat.length >= 5 && form.darurat && form.daruratHp.length >= 8);
    if (step === 3) return Boolean(form.paspor.length >= 6 && form.pExpiry && passportCheck?.valid);
    if (step === 4) return !mahramWajib || Boolean(form.mahram && form.mahramRel);
    if (step === 5) return true;
    if (step === 6) return agree;
    return false;
  }, [step, pkg, form, passportCheck, mahramWajib, agree]);

  async function submit() {
    if (!pkg?.departure) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/registrations', {
        departureId: pkg.departure.id,
        roomType: room,
        paymentScheme: scheme,
        source: referral.trim() ? `agent:${referral.trim().toUpperCase()}` : 'web',
        jamaah: {
          nik: form.nik, fullName: form.nama, gender: form.gender, birthPlace: form.tmpt, birthDate: form.tgl,
          phone: form.hp, email: form.email || null, address: form.alamat,
          emergencyContactName: form.darurat, emergencyContactPhone: form.daruratHp,
          passportNo: form.paspor || null, passportIssuedAt: form.pIssue || null, passportExpiry: form.pExpiry || null,
          mahramName: form.mahram || null, mahramRelation: form.mahramRel || null
        }
      });
      const jamaahId = data.data.jamaahId as string;
      let uploaded = 0;
      for (const [docType, file] of Object.entries(files)) {
        if (!file) continue;
        const fd = new FormData();
        fd.append('docType', docType);
        fd.append('file', file);
        await api.post(`/jamaah/${jamaahId}/documents`, fd);
        uploaded++;
      }
      setDone({ regNumber: data.data.regNumber, docsUploaded: uploaded });
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ??
          'Terjadi kesalahan, coba lagi'
      );
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep(1); setPkg(null); setForm(EMPTY_FORM); setFiles({}); setRoom('quad');
    setScheme('dp'); setMethod('va'); setAgree(false); setDone(null); setError('');
  }

  /* ============ Render ============ */

  return (
    <div className="min-h-screen bg-[#ece4d3] px-4 py-8">
      <div className="mx-auto max-w-[1060px]">
        {/* Brand header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-gold font-display text-xl text-[#20180a]">S</div>
          <div>
            <div className="font-display text-[19px] leading-none text-ink-strong">Safar</div>
            <div className="mt-[3px] text-[10.5px] uppercase tracking-[1px] text-muted-3">Pendaftaran Jamaah Online</div>
          </div>
        </div>

        {done ? (
          <SuccessScreen regNumber={done.regNumber} docsUploaded={done.docsUploaded} scheme={scheme} method={method} dueNow={dueNow} onRestart={restart} />
        ) : (
          <>
            {/* Stepper */}
            <div className="mb-6 flex items-center">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const state = n < step ? 'done' : n === step ? 'active' : 'next';
                return (
                  <div key={label} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold"
                        style={
                          state === 'done'
                            ? { background: 'var(--color-primary)', color: '#fff' }
                            : state === 'active'
                              ? { background: 'var(--color-gold)', color: '#20180a' }
                              : { background: '#f0eadc', color: '#a89e88' }
                        }
                      >
                        {state === 'done' ? '✓' : n}
                      </div>
                      <span className="mt-1.5 text-[10.5px] font-semibold" style={{ color: state === 'next' ? '#a89e88' : '#2c281f' }}>
                        {label}
                      </span>
                    </div>
                    {n < STEPS.length && (
                      <div className="mx-2 mb-5 h-[2px] flex-1" style={{ background: n < step ? 'var(--color-primary)' : '#ddd3bd' }} />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-[1fr_320px] gap-5 max-md:grid-cols-1">
              {/* Kartu form */}
              <div className="rounded-[16px] border border-line bg-card p-6 shadow-float">
                {step === 1 && <StepPaket pakets={pakets ?? []} selected={pkg} onSelect={setPkg} />}
                {step === 2 && <StepDataDiri form={form} set={set} setForm={setForm} />}
                {step === 3 && (
                  <StepDokumen form={form} set={set} files={files} setFiles={setFiles} passportCheck={passportCheck ?? null} hasExpiry={Boolean(form.pExpiry)} />
                )}
                {step === 4 && <StepKamar pkg={pkg} room={room} setRoom={setRoom} form={form} set={set} mahramWajib={Boolean(mahramWajib)} />}
                {step === 5 && (
                  <StepBayar scheme={scheme} setScheme={setScheme} method={method} setMethod={setMethod} total={total} referral={referral} setReferral={setReferral} />
                )}
                {step === 6 && (
                  <StepKonfirmasi pkg={pkg} form={form} room={room} files={files} scheme={scheme} method={method} dueNow={dueNow} agree={agree} setAgree={setAgree} />
                )}

                {error && <div className="mt-4 rounded-[9px] bg-danger-bg px-3.5 py-2.5 text-[12px] font-medium text-danger-deep">{error}</div>}

                {/* Nav */}
                <div className="mt-6 flex items-center justify-between border-t border-line-3 pt-4">
                  <button
                    onClick={() => setStep(Math.max(1, step - 1))}
                    disabled={step === 1 || busy}
                    className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2.5 text-[13px] font-semibold text-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ← Kembali
                  </button>
                  {step < 6 ? (
                    <button
                      onClick={() => canProceed && setStep(step + 1)}
                      disabled={!canProceed}
                      className="rounded-[9px] px-5 py-2.5 text-[13px] font-semibold text-white"
                      style={canProceed ? { background: 'var(--color-primary)', cursor: 'pointer' } : { background: '#c9bfa8', cursor: 'not-allowed' }}
                    >
                      Lanjut →
                    </button>
                  ) : (
                    <button
                      onClick={submit}
                      disabled={!canProceed || busy}
                      className="rounded-[9px] px-5 py-2.5 text-[13px] font-semibold text-white"
                      style={canProceed && !busy ? { background: 'var(--color-primary)', cursor: 'pointer' } : { background: '#c9bfa8', cursor: 'not-allowed' }}
                    >
                      {busy ? 'Memproses…' : 'Kirim Pendaftaran'}
                    </button>
                  )}
                </div>
              </div>

              {/* Sidebar ringkasan */}
              <aside className="h-fit overflow-hidden rounded-[16px] border border-line bg-card shadow-float max-md:order-first">
                <div className="p-4 text-white" style={{ background: 'linear-gradient(135deg,oklch(0.44 0.08 175),oklch(0.5 0.09 165))' }}>
                  <div className="text-[11px] uppercase tracking-[0.6px] text-white/75">Ringkasan Pendaftaran</div>
                  <div className="mt-1 font-display text-[17px]">{pkg?.name ?? 'Belum pilih paket'}</div>
                  <div className="text-[11px] text-white/80">{pkg?.departure ? fmtDate(pkg.departure.date, 'long') : '—'}</div>
                </div>
                <div className="flex flex-col gap-2 p-4 text-[12px]">
                  <div className="flex justify-between"><span className="text-muted-2">Harga paket</span><span className="font-mono">{pkg ? fmtShort(pkg.basePrice) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-2">Kamar ({ROOMS.find((r) => r.id === room)?.label})</span><span className="font-mono">{roomUp ? `+ ${fmtShort(roomUp)}` : 'Termasuk'}</span></div>
                  <div className="flex justify-between border-t border-line-3 pt-2 text-[13px] font-semibold"><span>Total</span><span className="font-mono">{pkg ? fmtShort(total) : '—'}</span></div>
                  <div className="mt-1 flex items-center justify-between rounded-[9px] px-3 py-2.5" style={{ background: 'oklch(0.95 0.04 82)' }}>
                    <span className="font-semibold text-[oklch(0.45_0.1_78)]">Bayar sekarang</span>
                    <span className="font-mono font-semibold text-[oklch(0.45_0.1_78)]">{pkg ? fmtShort(dueNow) : '—'}</span>
                  </div>
                  <div className="mt-1 text-[10.5px] leading-relaxed text-muted-3">
                    Pembayaran dicatat sebagai <b>Uang Muka Jamaah</b> dan baru diakui sebagai pendapatan saat keberangkatan (<b>PSAK 72</b>).
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============ Step 1 — Paket ============ */
function StepPaket({ pakets, selected, onSelect }: { pakets: PaketRow[]; selected: PaketRow | null; onSelect: (p: PaketRow) => void }) {
  return (
    <div>
      <StepTitle title="Pilih Paket & Keberangkatan" sub="Sisa kuota diperbarui real-time." />
      <div className="flex flex-col gap-2.5">
        {pakets
          .filter((p) => p.isActive && p.departure)
          .map((p) => {
            const on = selected?.id === p.id;
            const left = p.departure!.seatsLeft;
            const full = left <= 0;
            return (
              <button
                key={p.id}
                onClick={() => !full && onSelect(p)}
                disabled={full}
                className="flex items-center gap-3.5 rounded-[11px] border p-3.5 text-left"
                style={{
                  borderColor: on ? 'var(--color-primary)' : '#e5dcc8',
                  background: on ? '#fffdf8' : '#f7f2e8',
                  boxShadow: on ? 'var(--shadow-card)' : 'none',
                  cursor: full ? 'not-allowed' : 'pointer',
                  opacity: full ? 0.55 : 1
                }}
              >
                <span className="h-4 w-4 flex-none rounded-full border-2" style={{ borderColor: on ? 'var(--color-primary)' : '#c9bfa8', background: on ? 'var(--color-primary)' : 'transparent' }} />
                <div className="flex-1">
                  <div className="text-[13.5px] font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted-2">{p.hotel ?? '—'} · {p.airline ?? '—'} · {p.durationDays} hari</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[14px] font-semibold">{fmtShort(p.basePrice)}</div>
                  <div className="text-[10.5px] text-muted-3">{fmtDate(p.departure!.date)}</div>
                  <div className="text-[10.5px] font-semibold" style={{ color: full ? 'oklch(0.55 0.15 28)' : left <= 6 ? 'oklch(0.55 0.15 28)' : 'oklch(0.46 0.07 158)' }}>
                    {full ? 'Penuh' : `Sisa ${left} kursi`}
                  </div>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}

/* ============ Step 2 — Data Diri ============ */
function StepDataDiri({ form, set, setForm }: {
  form: typeof EMPTY_FORM;
  set: (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  setForm: (f: typeof EMPTY_FORM) => void;
}) {
  return (
    <div>
      <StepTitle title="Data Diri Jamaah" sub="Isi persis sesuai paspor." />
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2"><label className="lbl">Nama Lengkap (sesuai paspor)</label><input className="fld" value={form.nama} onChange={set('nama')} placeholder="AHMAD FAUZI BIN SUDIRMAN" /></div>
        <div><label className="lbl">NIK (16 digit)</label><input className="fld" value={form.nik} onChange={set('nik')} placeholder="3175xxxxxxxxxxxx" maxLength={16} /></div>
        <div><label className="lbl">No. HP / WhatsApp</label><input className="fld" value={form.hp} onChange={set('hp')} placeholder="08xx-xxxx-xxxx" /></div>
        <div><label className="lbl">Tempat Lahir</label><input className="fld" value={form.tmpt} onChange={set('tmpt')} /></div>
        <div><label className="lbl">Tanggal Lahir</label><input type="date" className="fld" value={form.tgl} onChange={set('tgl')} /></div>
        <div>
          <label className="lbl">Jenis Kelamin</label>
          <div className="flex overflow-hidden rounded-[9px] border border-field">
            {(['L', 'P'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setForm({ ...form, gender: g })}
                className="flex-1 cursor-pointer py-[11px] text-[13px] font-semibold"
                style={form.gender === g ? { background: 'var(--color-primary)', color: '#fff' } : { background: '#fffdf8', color: '#6f6858' }}
              >
                {g === 'L' ? 'Laki-laki' : 'Perempuan'}
              </button>
            ))}
          </div>
        </div>
        <div><label className="lbl">Email</label><input type="email" className="fld" value={form.email} onChange={set('email')} /></div>
        <div className="col-span-2"><label className="lbl">Alamat Domisili</label><input className="fld" value={form.alamat} onChange={set('alamat')} /></div>
        <div><label className="lbl">Kontak Darurat (Nama)</label><input className="fld" value={form.darurat} onChange={set('darurat')} /></div>
        <div><label className="lbl">No. HP Kontak Darurat</label><input className="fld" value={form.daruratHp} onChange={set('daruratHp')} /></div>
      </div>
    </div>
  );
}

/* ============ Step 3 — Dokumen ============ */
function StepDokumen({ form, set, files, setFiles, passportCheck, hasExpiry }: {
  form: typeof EMPTY_FORM;
  set: (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  files: Record<string, File | null>;
  setFiles: (f: Record<string, File | null>) => void;
  passportCheck: { valid: boolean; minValidUntil: string } | null;
  hasExpiry: boolean;
}) {
  return (
    <div>
      <StepTitle title="Unggah Dokumen" sub="JPG/PNG/PDF, maks 5 MB. Dokumen diverifikasi tim operasional setelah pendaftaran." />
      <div className="flex flex-col gap-2">
        {DOCS.map((d) => {
          const file = files[d.id];
          return (
            <label
              key={d.id}
              className="flex cursor-pointer items-center gap-3 rounded-[10px] border p-3"
              style={file ? { borderColor: 'oklch(0.85 0.06 158)', background: 'oklch(0.97 0.02 158)' } : { border: '1.5px dashed #d9cfb9', background: '#fffdf8' }}
            >
              <span
                className="flex h-[30px] w-[38px] flex-none items-center justify-center rounded-[6px] text-[9px] font-bold"
                style={file ? { background: 'oklch(0.46 0.07 158)', color: '#fff' } : { background: '#f0eadc', color: '#8c8371' }}
              >
                {d.id}
              </span>
              <div className="flex-1">
                <div className="text-[12.5px] font-semibold">{d.name}</div>
                <div className="text-[10.5px] text-muted-3">{d.hint}</div>
              </div>
              <span className="text-[11px] font-semibold" style={{ color: file ? 'oklch(0.46 0.07 158)' : 'var(--color-primary)' }}>
                {file ? `✓ ${file.name.length > 22 ? file.name.slice(0, 20) + '…' : file.name}` : 'Unggah file'}
              </span>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                className="hidden"
                onChange={(e) => setFiles({ ...files, [d.id]: e.target.files?.[0] ?? null })}
              />
            </label>
          );
        })}
      </div>

      <div className="mt-5 rounded-[11px] border border-line-3 bg-panel p-4">
        <div className="mb-3 text-[12.5px] font-semibold">Validasi Paspor</div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="lbl">No. Paspor</label><input className="fld" value={form.paspor} onChange={set('paspor')} placeholder="C1234567" /></div>
          <div><label className="lbl">Tanggal Terbit</label><input type="date" className="fld" value={form.pIssue} onChange={set('pIssue')} /></div>
          <div><label className="lbl">Berlaku Sampai</label><input type="date" className="fld" value={form.pExpiry} onChange={set('pExpiry')} /></div>
        </div>
        {hasExpiry && passportCheck && (
          <div
            className="mt-3 rounded-[9px] px-3.5 py-2.5 text-[11.5px] font-medium"
            style={
              passportCheck.valid
                ? { background: 'oklch(0.95 0.03 158)', color: 'oklch(0.4 0.07 158)' }
                : { background: 'oklch(0.96 0.04 30)', color: 'oklch(0.48 0.13 28)' }
            }
          >
            {passportCheck.valid
              ? '✓ Paspor valid — memenuhi syarat minimal 7 bulan setelah keberangkatan.'
              : `Paspor tidak memenuhi syarat: harus berlaku hingga minimal ${fmtDate(passportCheck.minValidUntil, 'long')} (≥ 7 bulan setelah keberangkatan). Harap perpanjang paspor.`}
          </div>
        )}
        {!hasExpiry && (
          <div className="mt-3 rounded-[9px] bg-[oklch(0.97_0.02_245)] px-3.5 py-2.5 text-[11.5px] text-[oklch(0.45_0.06_245)]">
            Isi masa berlaku paspor untuk validasi otomatis (aturan: ≥ 7 bulan setelah tanggal keberangkatan).
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ Step 4 — Kamar & Mahram ============ */
function StepKamar({ pkg, room, setRoom, form, set, mahramWajib }: {
  pkg: PaketRow | null;
  room: 'quad' | 'triple' | 'double';
  setRoom: (r: 'quad' | 'triple' | 'double') => void;
  form: typeof EMPTY_FORM;
  set: (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  mahramWajib: boolean;
}) {
  return (
    <div>
      <StepTitle title="Kamar & Mahram" sub="Pilih tipe kamar hotel; biaya tambahan dihitung dari kuota Quad." />
      <div className="grid grid-cols-3 gap-3">
        {ROOMS.map((r) => {
          const up = r.id === 'triple' ? pkg?.tripleUpcharge ?? 0 : r.id === 'double' ? pkg?.doubleUpcharge ?? 0 : 0;
          const on = room === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setRoom(r.id)}
              className="cursor-pointer rounded-[11px] border p-4 text-center"
              style={{ borderColor: on ? 'var(--color-primary)' : '#e5dcc8', background: on ? '#fffdf8' : '#f7f2e8', boxShadow: on ? 'var(--shadow-card)' : 'none' }}
            >
              <div className="text-[14px] font-semibold">{r.label}</div>
              <div className="text-[10.5px] text-muted-3">{r.desc}</div>
              <div className="mt-2 font-mono text-[12px] font-semibold" style={{ color: up ? 'oklch(0.5 0.1 78)' : 'oklch(0.46 0.07 158)' }}>
                {up ? `+ ${fmtShort(up)}` : 'Termasuk'}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-[11px] border border-line-3 bg-panel p-4">
        <div className="text-[12.5px] font-semibold">Mahram / Pendamping {mahramWajib && <span className="text-danger-deep">— wajib</span>}</div>
        <div className="mb-3 mt-1 text-[10.5px] text-muted-3">Jamaah perempuan di bawah 45 tahun wajib didampingi mahram.</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Nama Mahram</label><input className="fld" value={form.mahram} onChange={set('mahram')} placeholder="mis. suami / anak laki-laki" /></div>
          <div><label className="lbl">Hubungan</label><input className="fld" value={form.mahramRel} onChange={set('mahramRel')} placeholder="mis. Suami" /></div>
        </div>
      </div>
    </div>
  );
}

/* ============ Step 5 — Pembayaran ============ */
function StepBayar({ scheme, setScheme, method, setMethod, total, referral, setReferral }: {
  scheme: 'dp' | 'cicil' | 'lunas';
  setScheme: (s: 'dp' | 'cicil' | 'lunas') => void;
  method: 'va' | 'card' | 'manual';
  setMethod: (m: 'va' | 'card' | 'manual') => void;
  total: number;
  referral: string;
  setReferral: (v: string) => void;
}) {
  return (
    <div>
      <StepTitle title="Skema & Metode Pembayaran" sub="Dana jamaah dikelola dengan akad wakalah — dicatat sebagai titipan hingga keberangkatan." />
      <div className="flex flex-col gap-2.5">
        {SCHEMES.map((s) => {
          const on = scheme === s.id;
          const due = s.id === 'lunas' ? total : DP_AMOUNT;
          return (
            <button
              key={s.id}
              onClick={() => setScheme(s.id)}
              className="flex cursor-pointer items-center gap-3.5 rounded-[11px] border p-3.5 text-left"
              style={{ borderColor: on ? 'var(--color-primary)' : '#e5dcc8', background: on ? '#fffdf8' : '#f7f2e8', boxShadow: on ? 'var(--shadow-card)' : 'none' }}
            >
              <span className="h-4 w-4 flex-none rounded-full border-2" style={{ borderColor: on ? 'var(--color-primary)' : '#c9bfa8', background: on ? 'var(--color-primary)' : 'transparent' }} />
              <div className="flex-1">
                <div className="text-[13px] font-semibold">{s.label}</div>
                <div className="text-[11px] text-muted-2">{s.desc}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-3">Bayar sekarang</div>
                <div className="font-mono text-[13px] font-semibold">{fmtShort(due)}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {METHODS.map((m) => {
          const on = method === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className="cursor-pointer rounded-[11px] border p-3.5 text-center"
              style={{ borderColor: on ? 'var(--color-primary)' : '#e5dcc8', background: on ? '#fffdf8' : '#f7f2e8' }}
            >
              <div className="text-[12.5px] font-semibold">{m.label}</div>
              <div className="text-[10.5px] text-muted-3">{m.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-[11px] border border-line-3 bg-panel p-4">
        <label className="lbl">Kode Referral Agen (opsional)</label>
        <input className="fld font-mono !w-[220px]" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} placeholder="mis. BRKH-07" />
        <div className="mt-1.5 text-[10.5px] text-muted-3">Isi bila Anda mendaftar melalui agen/mitra Safar.</div>
      </div>
    </div>
  );
}

/* ============ Step 6 — Konfirmasi ============ */
function StepKonfirmasi({ pkg, form, room, files, scheme, method, dueNow, agree, setAgree }: {
  pkg: PaketRow | null;
  form: typeof EMPTY_FORM;
  room: string;
  files: Record<string, File | null>;
  scheme: string;
  method: string;
  dueNow: number;
  agree: boolean;
  setAgree: (v: boolean) => void;
}) {
  const nFiles = Object.values(files).filter(Boolean).length;
  const rows: [string, string][] = [
    ['Paket', pkg?.name ?? '—'],
    ['Keberangkatan', pkg?.departure ? fmtDate(pkg.departure.date, 'long') : '—'],
    ['Nama Jamaah', form.nama || '—'],
    ['NIK', form.nik || '—'],
    ['No. Paspor', form.paspor || '—'],
    ['Tipe Kamar', ROOMS.find((r) => r.id === room)?.label ?? '—'],
    ['Dokumen Terunggah', `${nFiles} dari 6 dokumen`],
    ['Skema Pembayaran', `${SCHEMES.find((s) => s.id === scheme)?.label} · ${METHODS.find((m) => m.id === method)?.label}`],
    ['Bayar Sekarang', fmtFull(dueNow)]
  ];
  return (
    <div>
      <StepTitle title="Konfirmasi Pendaftaran" sub="Periksa kembali sebelum mengirim." />
      <div className="overflow-hidden rounded-[11px] border border-line-3">
        {rows.map(([k, v], i) => (
          <div key={k} className="flex gap-3 px-4 py-2.5 text-[12.5px]" style={{ background: i % 2 ? '#faf8f2' : '#fffdf8' }}>
            <span className="w-[170px] flex-none font-semibold text-muted-2">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-ink">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span>
          Saya menyetujui <b>akad wakalah/ijarah</b> serta syarat & ketentuan PT Safar Barokah Wisata, dan menyatakan seluruh data yang diisi benar.
        </span>
      </label>
    </div>
  );
}

/* ============ Success ============ */
function SuccessScreen({ regNumber, docsUploaded, scheme, method, dueNow, onRestart }: {
  regNumber: string; docsUploaded: number; scheme: string; method: string; dueNow: number; onRestart: () => void;
}) {
  const steps = [
    `Bayar ${SCHEMES.find((s) => s.id === scheme)?.label} — ${fmtFull(dueNow)} via ${METHODS.find((m) => m.id === method)?.label}. Instruksi pembayaran dikirim via WhatsApp.`,
    `Lengkapi dokumen — ${Math.max(0, 6 - docsUploaded)} dokumen lagi dapat diunggah menyusul.`,
    'Tim kami memverifikasi data & dokumen Anda. Pantau status di portal jamaah.'
  ];
  return (
    <div className="mx-auto max-w-[560px] rounded-[16px] border border-line bg-card p-8 text-center shadow-float">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl text-white" style={{ background: 'oklch(0.46 0.07 158)' }}>✓</div>
      <div className="mt-4 font-display text-[24px] text-ink-strong">Pendaftaran Berhasil</div>
      <div className="mt-1 text-[12.5px] text-muted-2">Simpan nomor registrasi Anda:</div>
      <div className="mx-auto mt-3 w-fit rounded-[10px] border border-line-2 bg-panel px-6 py-3 font-mono text-[20px] font-semibold tracking-wide text-ink-strong">
        {regNumber}
      </div>
      <div className="mt-6 flex flex-col gap-2.5 text-left">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3 rounded-[10px] border border-line-3 bg-panel p-3">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold text-[11px] font-bold text-[#20180a]">{i + 1}</span>
            <span className="text-[12px] leading-relaxed">{s}</span>
          </div>
        ))}
      </div>
      <button onClick={onRestart} className="mt-6 cursor-pointer rounded-[9px] bg-primary px-6 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-deep">
        Selesai
      </button>
    </div>
  );
}

/* ============ Util ============ */
function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <div className="font-display text-[19px] text-ink-strong">{title}</div>
      <div className="mt-0.5 text-[11.5px] text-muted-3">{sub}</div>
    </div>
  );
}
