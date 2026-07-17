import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtFull, fmtDate, age } from '../utils/format';

interface Detail {
  id: string;
  nik: string;
  full_name: string;
  gender: 'L' | 'P';
  birth_place: string | null;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  passport_no: string | null;
  passport_expiry: string | null;
  mahram_name: string | null;
  mahram_relation: string | null;
  registrations: {
    id: string; regNumber: string; packageName: string; departureDate: string; returnDate: string;
    roomType: string; roomNumber: string | null; groupName: string | null; paymentScheme: string;
    status: string; totalPrice: number;
  }[];
  documents: { id: string; doc_type: string; file_url: string; status: string; verified_at: string | null; note: string | null }[];
}

const DOC_NAMES: Record<string, string> = {
  KTP: 'KTP', KK: 'Kartu Keluarga', PPR: 'Paspor', FTO: 'Pas Foto 4×6', VKS: 'Kartu Vaksin Meningitis', NKH: 'Buku Nikah'
};
const DOC_ORDER = ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'];

const STATUS_PILL: Record<string, { label: string; color: string; bg: string }> = {
  verified: { label: 'Terverifikasi', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  pending: { label: 'Menunggu', color: 'oklch(0.48 0.03 90)', bg: '#f2ecdf' },
  rejected: { label: 'Ditolak', color: '#fff', bg: 'oklch(0.55 0.15 28)' },
  missing: { label: 'Belum diunggah', color: '#b0a68f', bg: '#faf7f0' }
};

const REG_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending_documents: { label: 'Menunggu Dokumen', color: 'oklch(0.45 0.10 78)', bg: 'oklch(0.95 0.04 82)' },
  active: { label: 'Aktif', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  completed: { label: 'Selesai', color: '#6f6858', bg: '#f2ecdf' },
  cancelled: { label: 'Batal', color: '#fff', bg: 'oklch(0.55 0.15 28)' }
};

const ROOM_LABEL: Record<string, string> = { quad: 'Quad', triple: 'Triple', double: 'Double' };
const SCHEME_LABEL: Record<string, string> = { dp: 'Uang Muka (DP)', cicil: 'Cicilan 6× Termin', lunas: 'Lunas' };

export function JamaahDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: j, isLoading } = useQuery({
    queryKey: ['jamaah-detail', id],
    queryFn: async () => (await api.get(`/jamaah/${id}`)).data.data as Detail
  });

  const verify = useMutation({
    mutationFn: async (p: { docId: string; status: 'verified' | 'rejected'; note?: string }) =>
      api.patch(`/documents/${p.docId}/verify`, { status: p.status, note: p.note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jamaah-detail', id] })
  });

  if (isLoading) return <div className="text-[12.5px] text-muted-2">Memuat detail jamaah…</div>;
  if (!j) return <div className="text-[12.5px] text-muted-2">Jamaah tidak ditemukan.</div>;

  const canVerify = user && ['admin', 'operasional'].includes(user.role);
  const info: [string, string | null][] = [
    ['NIK', j.nik],
    ['Jenis Kelamin', j.gender === 'L' ? 'Laki-laki' : 'Perempuan'],
    ['Tempat, Tgl Lahir', j.birth_place && j.birth_date ? `${j.birth_place}, ${fmtDate(j.birth_date, 'long')} (${age(j.birth_date)} th)` : null],
    ['No. HP / WhatsApp', j.phone],
    ['Email', j.email],
    ['Alamat', j.address],
    ['Kontak Darurat', j.emergency_contact_name ? `${j.emergency_contact_name} · ${j.emergency_contact_phone ?? ''}` : null],
    ['No. Paspor', j.passport_no],
    ['Paspor Berlaku s/d', j.passport_expiry ? fmtDate(j.passport_expiry, 'long') : null],
    ['Mahram', j.mahram_name ? `${j.mahram_name} (${j.mahram_relation ?? '—'})` : '—']
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/jamaah" className="text-[12px] font-semibold text-primary hover:underline">← Kembali ke daftar jamaah</Link>
      </div>

      <div className="grid grid-cols-[1.3fr_1fr] gap-4 max-lg:grid-cols-1">
        {/* Profil */}
        <div className="rounded-card border border-line bg-card p-6 shadow-card">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-[15px] font-bold text-white">
              {j.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div>
              <div className="font-display text-[20px] text-ink-strong">{j.full_name}</div>
              <div className="text-[11.5px] text-muted-3">Profil Jamaah</div>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2.5">
            {info.map(([k, v]) => (
              <div key={k} className="flex gap-3 text-[12px]">
                <span className="w-[150px] flex-none font-semibold text-muted-2">{k}</span>
                <span className="text-ink">{v ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pendaftaran */}
        <div className="rounded-card border border-line bg-card p-6 shadow-card">
          <div className="mb-3 text-[14px] font-semibold">Pendaftaran</div>
          <div className="flex flex-col gap-3">
            {j.registrations.map((r) => {
              const st = REG_STATUS[r.status] ?? REG_STATUS.pending_documents;
              return (
                <div key={r.id} className="rounded-[10px] border border-line-3 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11.5px] text-muted">{r.regNumber}</span>
                    <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold" style={{ color: st.color, background: st.bg }}>
                      {st.label}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[13px] font-semibold">{r.packageName}</div>
                  <div className="mt-1 text-[11px] text-muted-2">
                    {fmtDate(r.departureDate, 'long')} — {fmtDate(r.returnDate, 'long')}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                    <span>Kamar: <b>{ROOM_LABEL[r.roomType]}{r.roomNumber ? ` · ${r.roomNumber}` : ''}</b></span>
                    <span>Rombongan: <b>{r.groupName ?? '—'}</b></span>
                    <span>Skema: <b>{SCHEME_LABEL[r.paymentScheme]}</b></span>
                  </div>
                  <div className="mt-2 border-t border-line-3 pt-2 text-[12px]">
                    Total tagihan: <span className="font-mono font-semibold">{fmtFull(r.totalPrice)}</span>
                  </div>
                </div>
              );
            })}
            {j.registrations.length === 0 && <div className="text-[12px] text-muted-2">Belum ada pendaftaran.</div>}
          </div>
        </div>
      </div>

      {/* Dokumen */}
      <div className="rounded-card border border-line bg-card p-6 shadow-card">
        <div className="mb-1 text-[14px] font-semibold">Dokumen</div>
        <div className="mb-4 text-[11px] text-muted-3">
          5 dokumen wajib (KTP, KK, Paspor, Pas Foto, Vaksin Meningitis) + Buku Nikah opsional. Registrasi otomatis aktif saat semua dokumen wajib terverifikasi.
        </div>
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1">
          {DOC_ORDER.map((type) => {
            const doc = j.documents.find((d) => d.doc_type === type);
            const st = STATUS_PILL[doc?.status ?? 'missing'];
            return (
              <div key={type} className="rounded-[10px] border border-line-3 bg-panel p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold">{DOC_NAMES[type]}{type === 'NKH' && <span className="ml-1 text-[10px] font-normal text-muted-4">(opsional)</span>}</span>
                  <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                </div>
                {doc?.note && <div className="mt-1.5 text-[10.5px] text-danger-deep">Catatan: {doc.note}</div>}
                <div className="mt-2.5 flex items-center gap-2">
                  {doc && (
                    <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-primary hover:underline">
                      Lihat file
                    </a>
                  )}
                  {doc && canVerify && doc.status !== 'verified' && (
                    <>
                      <button
                        onClick={() => verify.mutate({ docId: doc.id, status: 'verified' })}
                        disabled={verify.isPending}
                        className="ml-auto cursor-pointer rounded-[7px] bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60"
                      >
                        ✓ Verifikasi
                      </button>
                      <button
                        onClick={() => {
                          const note = window.prompt('Alasan penolakan dokumen:');
                          if (note !== null) verify.mutate({ docId: doc.id, status: 'rejected', note });
                        }}
                        disabled={verify.isPending}
                        className="cursor-pointer rounded-[7px] border border-[oklch(0.85_0.08_30)] bg-danger-bg px-2.5 py-1 text-[10.5px] font-semibold text-danger-deep disabled:opacity-60"
                      >
                        Tolak
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
