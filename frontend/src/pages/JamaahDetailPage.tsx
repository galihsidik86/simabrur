import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../api/client';
import { useAuth } from '../store/auth';
import { hasRole } from '../routes/access';
import { refundStatusPill, type RefundDto } from '../api/refunds';
import { IDENTITY_PENDING_PILL, regStatusPill } from '../api/registrations';
import {
  AGENT_ATTRIBUTION_ROLES, commissionStatusPill, isCommissionLocked,
  type AgentRow, type AttributionResult, type RegistrationAgent
} from '../api/agents';
import { fmtFull, fmtDate, age } from '../utils/format';

/** Ambil berkas dokumen lewat endpoint ber-otentikasi (PII tidak lagi disajikan statis). */
async function openDocument(docId: string) {
  try {
    const res = await api.get(`/documents/${docId}/file`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    alert('Gagal membuka dokumen.');
  }
}

/**
 * Satu item `registrations[]` dari `GET /v1/jamaah/:id`. Atribusi agen
 * (`agentId`/`agentName`/`commissionStatus`) datang langsung dari endpoint ini.
 */
interface Registration extends RegistrationAgent {
  id: string; regNumber: string; packageName: string; departureDate: string; returnDate: string;
  roomType: string; roomNumber: string | null; groupName: string | null; paymentScheme: string;
  status: string; totalPrice: number;
  identityConfirmationRequired?: boolean;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  refund?: RefundDto | null;
}

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
  registrations: Registration[];
  documents: { id: string; doc_type: string; file_url: string; status: string; verified_at: string | null; note: string | null }[];
}

/** Respons `POST /registrations/:id/cancel`. */
interface CancelResult { registrationId: string; status: 'cancelled'; refund: RefundDto | null }

type Feedback = { regId: string; kind: 'error' | 'success'; text: string };

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

const PILL_CLASS = 'rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold';

const ROOM_LABEL: Record<string, string> = { quad: 'Quad', triple: 'Triple', double: 'Double' };
const SCHEME_LABEL: Record<string, string> = { dp: 'Uang Muka (DP)', cicil: 'Cicilan 6× Termin', lunas: 'Lunas' };

/** Kontrak: batal & konfirmasi identitas = operasional (+ admin, selalu lolos lewat hasRole). */
const REGISTRATION_WRITE_ROLES = ['operasional'] as const;
const CANCEL_REASON_MIN = 5;
const NON_CANCELLABLE_STATUSES = ['cancelled', 'completed'];
/** Query yang datanya berubah saat registrasi dibatalkan (kursi, piutang, dokumen, manifest, komisi, refund). */
const CANCEL_AFFECTED_QUERIES = [
  'jamaah-detail', 'jamaah', 'receivables', 'refunds', 'dashboard', 'notifications',
  'report-aging', 'report-compliance', 'report-readiness', 'departures-list', 'manifest', 'packages',
  'commissions-pending', 'commissions-approved', 'agents', 'invoice-doc', 'invoice-payments'
] as const;

/**
 * Query yang datanya berubah setelah agen registrasi ditetapkan/dialihkan
 * (`POST /v1/commissions/attribute` mengubah registrations.agent_id + baris komisi
 * pending, dan mengirim notifikasi ke agen).
 */
const ATTRIBUTE_AFFECTED_QUERIES = [
  'jamaah-detail', 'jamaah', 'commissions-pending', 'commissions-approved', 'agents', 'notifications'
] as const;

export function JamaahDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null);
  const [attributeTarget, setAttributeTarget] = useState<Registration | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const canAttribute = hasRole(user?.role, AGENT_ATTRIBUTION_ROLES);

  const { data: j, isLoading } = useQuery({
    queryKey: ['jamaah-detail', id],
    queryFn: async () => (await api.get(`/jamaah/${id}`)).data.data as Detail
  });

  const verify = useMutation({
    mutationFn: async (p: { docId: string; status: 'verified' | 'rejected'; note?: string }) =>
      api.patch(`/documents/${p.docId}/verify`, { status: p.status, note: p.note ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jamaah-detail', id] })
  });

  const confirmIdentity = useMutation({
    mutationFn: async (regId: string) => api.patch(`/registrations/${regId}/confirm-identity`),
    onMutate: () => setFeedback(null),
    onSuccess: (_res, regId) => {
      setFeedback({ regId, kind: 'success', text: 'Identitas dikonfirmasi — login Portal Jamaah dengan nomor registrasi ini kini dibuka.' });
      qc.invalidateQueries({ queryKey: ['jamaah-detail', id] });
    },
    onError: (e, regId) => setFeedback({ regId, kind: 'error', text: apiErrorMessage(e, 'Gagal mengonfirmasi identitas') })
  });

  if (isLoading) return <div className="text-[12.5px] text-muted-2">Memuat detail jamaah…</div>;
  if (!j) return <div className="text-[12.5px] text-muted-2">Jamaah tidak ditemukan.</div>;

  const canOperate = hasRole(user?.role, REGISTRATION_WRITE_ROLES);
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

  const handleConfirmIdentity = (r: Registration) => {
    const ok = window.confirm(
      `Konfirmasi identitas pendaftaran ${r.regNumber}?\n\n` +
      `NIK ini sudah pernah terdaftar. Pastikan pendaftar benar ${j.full_name} — pemilik NIK tersebut ` +
      '(cocokkan KTP/KK asli atau hubungi nomor yang sudah terdaftar) sebelum membuka akses Portal Jamaah, ' +
      'karena portal menampilkan data pribadi, dokumen, dan pembayaran jamaah.'
    );
    if (ok) confirmIdentity.mutate(r.id);
  };

  const handleCancelled = (res: CancelResult) => {
    setCancelTarget(null);
    setFeedback({
      regId: res.registrationId,
      kind: 'success',
      text: res.refund
        ? `Pendaftaran dibatalkan. Refund atas pembayaran terverifikasi ${fmtFull(res.refund.paidTotal)} diajukan ke Keuangan.`
        : 'Pendaftaran dibatalkan. Tidak ada pembayaran terverifikasi, sehingga tidak ada refund.'
    });
    CANCEL_AFFECTED_QUERIES.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };

  const handleAttributed = (res: AttributionResult) => {
    setAttributeTarget(null);
    setFeedback({
      regId: res.registrationId,
      kind: 'success',
      text: `Pendaftaran kini teratribusi ke ${res.agentName}. Komisi pending ${fmtFull(res.amount)} menunggu persetujuan Keuangan.`
    });
    ATTRIBUTE_AFFECTED_QUERIES.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };

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
            {j.registrations.map((r) => (
              <RegistrationCard
                key={r.id}
                r={r}
                canOperate={canOperate}
                canAttribute={canAttribute}
                onAttribute={() => { setFeedback(null); setAttributeTarget(r); }}
                feedback={feedback?.regId === r.id ? feedback : null}
                isConfirmPending={confirmIdentity.isPending}
                isConfirmingThis={confirmIdentity.isPending && confirmIdentity.variables === r.id}
                onConfirmIdentity={() => handleConfirmIdentity(r)}
                onCancel={() => { setFeedback(null); setCancelTarget(r); }}
              />
            ))}
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
                  <span className={PILL_CLASS} style={{ color: st.color, background: st.bg }}>{st.label}</span>
                </div>
                {doc?.note && <div className="mt-1.5 text-[10.5px] text-danger-deep">Catatan: {doc.note}</div>}
                <div className="mt-2.5 flex items-center gap-2">
                  {doc && (
                    <button onClick={() => openDocument(doc.id)} className="cursor-pointer text-[11px] font-semibold text-primary hover:underline">
                      Lihat file
                    </button>
                  )}
                  {doc && canOperate && doc.status !== 'verified' && (
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

      {cancelTarget && (
        <CancelRegistrationModal reg={cancelTarget} onClose={() => setCancelTarget(null)} onCancelled={handleCancelled} />
      )}

      {attributeTarget && (
        <AttributeAgentModal
          reg={attributeTarget}
          onClose={() => setAttributeTarget(null)}
          onAttributed={handleAttributed}
        />
      )}
    </div>
  );
}

/* ===== Kartu satu pendaftaran (status, pembatalan, refund, konfirmasi identitas) ===== */
interface RegistrationCardProps {
  r: Registration;
  canOperate: boolean;
  /** Role marketing/keuangan (admin lolos) — boleh menetapkan agen registrasi. */
  canAttribute: boolean;
  feedback: Feedback | null;
  isConfirmPending: boolean;
  isConfirmingThis: boolean;
  onConfirmIdentity: () => void;
  onCancel: () => void;
  onAttribute: () => void;
}

function RegistrationCard({
  r, canOperate, canAttribute, feedback, isConfirmPending, isConfirmingThis,
  onConfirmIdentity, onCancel, onAttribute
}: RegistrationCardProps) {
  const st = regStatusPill(r.status);
  const isCancelled = r.status === 'cancelled';
  const needsIdentity = r.identityConfirmationRequired === true && !isCancelled;
  const canCancel = canOperate && !NON_CANCELLABLE_STATUSES.includes(r.status);
  // Backend menolak (409) pengalihan bila komisi sudah disetujui/dibayar.
  const showAttribute = canAttribute && !isCancelled && !isCommissionLocked(r.commissionStatus);
  const showActions = canCancel || (needsIdentity && canOperate) || showAttribute;

  return (
    <div className="rounded-[10px] border border-line-3 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11.5px] text-muted">{r.regNumber}</span>
        <div className="flex flex-wrap justify-end gap-1.5">
          {needsIdentity && (
            <span className={PILL_CLASS} style={{ color: IDENTITY_PENDING_PILL.color, background: IDENTITY_PENDING_PILL.bg }}>
              {IDENTITY_PENDING_PILL.label}
            </span>
          )}
          <span className={PILL_CLASS} style={{ color: st.color, background: st.bg }}>{st.label}</span>
        </div>
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

      {canAttribute && <AgentAttribution r={r} />}

      {isCancelled && <CancellationSummary r={r} />}

      {needsIdentity && (
        <div className="mt-2 rounded-[8px] bg-panel px-3 py-2 text-[11px] text-muted">
          NIK jamaah ini sudah pernah terdaftar. Login Portal Jamaah dengan nomor registrasi ini ditahan sampai petugas mengonfirmasi bahwa pendaftar adalah pemilik NIK.
        </div>
      )}

      {showActions && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {needsIdentity && canOperate && (
            <button onClick={onConfirmIdentity} disabled={isConfirmPending}
              className="cursor-pointer rounded-[7px] bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
              {isConfirmingThis ? 'Mengonfirmasi…' : 'Konfirmasi identitas'}
            </button>
          )}
          {showAttribute && (
            <button onClick={onAttribute}
              className="cursor-pointer rounded-[7px] border border-line-2 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-primary">
              {r.agentId ? 'Ubah agen' : 'Tetapkan agen'}
            </button>
          )}
          {canCancel && (
            <button onClick={onCancel}
              className="ml-auto cursor-pointer rounded-[7px] border border-[oklch(0.85_0.08_30)] bg-danger-bg px-2.5 py-1 text-[10.5px] font-semibold text-danger-deep">
              Batalkan pendaftaran
            </button>
          )}
        </div>
      )}

      {feedback && (
        <div role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 rounded-[9px] px-3 py-2 text-[12px] font-medium ${feedback.kind === 'error' ? 'bg-danger-bg text-danger-deep' : 'bg-success-bg text-success'}`}>
          {feedback.text}
        </div>
      )}
    </div>
  );
}

/**
 * Ringkasan atribusi agen satu registrasi, langsung dari `GET /v1/jamaah/:id`
 * (`registrations[].agentId/agentName/commissionStatus`).
 */
function AgentAttribution({ r }: { r: Registration }) {
  if (!r.agentId) {
    return (
      <div className="mt-2 text-[11px] text-muted-3">
        Agen: <b className="text-muted-2">belum ada</b> — tidak ada komisi tercatat untuk pendaftaran ini.
      </div>
    );
  }
  const pill = r.commissionStatus ? commissionStatusPill(r.commissionStatus) : null;
  return (
    <div className="mt-2 rounded-[8px] border border-line-3 bg-panel px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span>Agen: <b className="text-ink">{r.agentName ?? '—'}</b></span>
        {pill && <span className={PILL_CLASS} style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>}
      </div>
      {isCommissionLocked(r.commissionStatus) && (
        <div className="mt-1 text-muted-3">Komisi sudah disetujui/dibayar — agen tidak bisa dialihkan lagi.</div>
      )}
      {!r.commissionStatus && (
        <div className="mt-1 text-muted-3">Belum ada baris komisi untuk pendaftaran ini.</div>
      )}
    </div>
  );
}

function CancellationSummary({ r }: { r: Registration }) {
  return (
    <>
      <div className="mt-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[11px] text-danger-deep">
        <div><b>Dibatalkan</b>{r.cancelledAt ? ` · ${fmtDate(r.cancelledAt, 'long')}` : ''}</div>
        {r.cancelReason && <div className="mt-0.5">Alasan: {r.cancelReason}</div>}
      </div>
      {r.refund && <RefundSummary refund={r.refund} />}
      {r.refund === null && (
        <div className="mt-1.5 text-[11px] text-muted-3">Tidak ada refund — belum ada pembayaran terverifikasi saat dibatalkan.</div>
      )}
    </>
  );
}

function RefundSummary({ refund }: { refund: RefundDto }) {
  const pill = refundStatusPill(refund.status);
  const amounts: [string, number][] = [
    ['Terbayar', refund.paidTotal],
    ['Potongan', refund.deduction],
    ['Dikembalikan', refund.refundAmount]
  ];
  return (
    <div className="mt-2 rounded-[8px] border border-line-3 bg-panel px-3 py-2.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-ink">Refund</span>
        <span className={PILL_CLASS} style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {amounts.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] text-muted-4">{label}</div>
            <div className="font-mono font-semibold">{fmtFull(value)}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-muted-3">
        {refund.status === 'paid' ? (
          <>
            Dibayar{refund.paidAt ? ` ${fmtDate(refund.paidAt)}` : ''}
            {refund.journalNumber && <> · jurnal <span className="font-mono">{refund.journalNumber}</span></>}
            {refund.receiptNumber && (
              <> · kwitansi{' '}
                <Link to={`/dokumen/refund/${refund.id}`} target="_blank" rel="noreferrer"
                  className="font-mono font-semibold text-primary hover:underline">
                  {refund.receiptNumber}
                </Link>
              </>
            )}
            {refund.deductionReason && <> · alasan potongan: {refund.deductionReason}</>}
          </>
        ) : (
          'Menunggu Keuangan menetapkan potongan dan membayar refund.'
        )}
      </div>
    </div>
  );
}

/* ===== Modal konfirmasi pembatalan pendaftaran ===== */
function CancelRegistrationModal({ reg, onClose, onCancelled }: {
  reg: Registration;
  onClose: () => void;
  onCancelled: (res: CancelResult) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const trimmed = reason.trim();
  const isReasonValid = trimmed.length >= CANCEL_REASON_MIN;

  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/registrations/${reg.id}/cancel`, { reason: trimmed })).data.data as CancelResult,
    onMutate: () => setError(''),
    onSuccess: onCancelled,
    onError: (e) => setError(apiErrorMessage(e, 'Gagal membatalkan pendaftaran'))
  });
  const close = () => { if (!cancel.isPending) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="cancel-reg-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto rounded-[15px] bg-card p-6 shadow-float">
        <div id="cancel-reg-title" className="font-display text-[19px] text-ink-strong">Batalkan Pendaftaran</div>
        <div className="mt-0.5 text-[12px] text-muted-2">
          <span className="font-mono">{reg.regNumber}</span> · {reg.packageName} · {fmtDate(reg.departureDate)}
        </div>

        <div className="mt-4 rounded-[9px] bg-danger-bg px-3.5 py-2.5 text-[11.5px] leading-relaxed text-danger-deep">
          <div className="font-semibold">Dampak pembatalan (tidak dapat diurungkan):</div>
          <ul className="mt-1 list-disc pl-4">
            <li>Kursi keberangkatan dilepas (kuota bertambah 1).</li>
            <li>Termin yang belum dibayar dibatalkan.</li>
            <li>Pembayaran yang masih menunggu verifikasi ditolak otomatis.</li>
            <li>Komisi agen yang belum dibayar dibatalkan; komisi yang sudah dibayar ditandai perlu ditagih ke agen.</li>
            <li>Bila ada pembayaran terverifikasi, refund diajukan ke Keuangan (potongan ditetapkan Keuangan saat membayar).</li>
          </ul>
          <div className="mt-1">Ditolak bila pendapatan keberangkatan sudah diakui atau rombongan sudah berangkat.</div>
        </div>

        <div className="mt-4">
          <label className="lbl" htmlFor="cancel-reason">Alasan pembatalan</label>
          <textarea id="cancel-reason" className="fld h-24" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Mis. jamaah sakit, permintaan keluarga, pindah jadwal…" disabled={cancel.isPending} />
          <div className="mt-1 text-[10.5px] text-muted-3">Minimal {CANCEL_REASON_MIN} karakter · tercatat di audit log.</div>
        </div>

        {error && <div role="alert" className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={close} disabled={cancel.isPending}
            className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60">
            Kembali
          </button>
          <button onClick={() => isReasonValid && cancel.mutate()} disabled={!isReasonValid || cancel.isPending}
            className="cursor-pointer rounded-[9px] bg-danger px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {cancel.isPending ? 'Membatalkan…' : 'Batalkan pendaftaran'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Modal atribusi agen (POST /v1/commissions/attribute) ===== */
function AttributeAgentModal({ reg, onClose, onAttributed }: {
  reg: Registration;
  onClose: () => void;
  onAttributed: (res: AttributionResult) => void;
}) {
  const hasAgent = reg.agentId !== null;
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState('');

  const { data: agentsData, isLoading: loadingAgents } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get('/agents')).data.data as { agents: AgentRow[] }
  });
  const agents = (agentsData?.agents ?? []).filter((a) => a.isActive);
  const selected = agents.find((a) => a.id === agentId) ?? null;
  // Estimasi mengikuti rumus backend: pct agen × total invoice, dibulatkan ke rupiah.
  const estimate = selected ? Math.round((reg.totalPrice * selected.commissionPct) / 100) : 0;

  const attribute = useMutation({
    mutationFn: async () =>
      (await api.post('/commissions/attribute', { registrationId: reg.id, agentId })).data.data as AttributionResult,
    onMutate: () => setError(''),
    onSuccess: onAttributed,
    onError: (e) => setError(apiErrorMessage(e, 'Gagal menetapkan agen'))
  });
  const close = () => { if (!attribute.isPending) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="attribute-agent-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[520px] max-w-full overflow-y-auto rounded-[15px] bg-card p-6 shadow-float">
        <div id="attribute-agent-title" className="font-display text-[19px] text-ink-strong">
          {hasAgent ? 'Alihkan Agen Pendaftaran' : 'Tetapkan Agen Pendaftaran'}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-2">
          <span className="font-mono">{reg.regNumber}</span> · {reg.packageName} · {fmtDate(reg.departureDate)}
        </div>

        <div className="mt-3 rounded-[9px] bg-panel px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted">
          Dipakai saat jamaah lupa menyebut kode referral atau salah agen. Tercatat di audit log dan agen
          menerima notifikasi. {hasAgent
            ? <>Agen saat ini: <b className="text-ink">{reg.agentName ?? '—'}</b> — komisi pending akan dipindah ke agen baru.</>
            : 'Belum ada agen pada pendaftaran ini — komisi pending baru akan dibuat.'}
        </div>

        <div className="mt-4">
          <label className="lbl" htmlFor="attribute-agent">Agen</label>
          <select id="attribute-agent" className="fld" value={agentId} onChange={(e) => setAgentId(e.target.value)}
            disabled={attribute.isPending || loadingAgents}>
            <option value="">{loadingAgents ? 'Memuat daftar agen…' : '— Pilih agen —'}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {a.referralCode} · {a.commissionPct}%</option>
            ))}
          </select>
          {!loadingAgents && agents.length === 0 && (
            <div className="mt-1 text-[10.5px] text-muted-3">Tidak ada agen aktif. Aktifkan agen di modul Marketing terlebih dahulu.</div>
          )}
        </div>

        {selected && (
          <div className="mt-3 rounded-[9px] px-3.5 py-2.5 text-[11.5px] leading-relaxed" style={{ background: 'oklch(0.95 0.04 82)', color: 'oklch(0.45 0.1 78)' }}>
            <div className="font-semibold">Dampak:</div>
            <ul className="mt-1 list-disc pl-4">
              <li>Pendaftaran diatribusikan ke <b>{selected.name}</b> ({selected.referralCode}).</li>
              <li>
                Komisi <b>pending</b> {selected.commissionPct}% × total tagihan {fmtFull(reg.totalPrice)} ={' '}
                <b className="font-mono">{fmtFull(estimate)}</b> {hasAgent ? 'menggantikan komisi pending sebelumnya' : 'dibuat'}.
              </li>
              <li>Belum ada jurnal — beban komisi baru terbentuk saat Keuangan menyetujui komisi.</li>
            </ul>
            <div className="mt-1">Nilai final dihitung ulang backend dari total invoice terbit; angka di atas adalah estimasi.</div>
          </div>
        )}

        {error && <div role="alert" className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={close} disabled={attribute.isPending}
            className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60">
            Kembali
          </button>
          <button onClick={() => agentId && attribute.mutate()} disabled={!agentId || attribute.isPending}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {attribute.isPending ? 'Menyimpan…' : 'Tetapkan agen'}
          </button>
        </div>
      </div>
    </div>
  );
}
