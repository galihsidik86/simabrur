import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './store/auth';
import { RequireAuth } from './routes/RequireAuth';
import { FINANCE_WRITE_ROLES, PAYMENT_DOC_ROLES, REFUND_RECEIPT_ROLES, rolesFor } from './routes/access';
import { AppShell } from './layouts/AppShell';
import { Login } from './pages/Login';
import { PaketPage } from './pages/PaketPage';
import { MasterPaketPage } from './pages/MasterPaketPage';
import { MasterKeuanganPage } from './pages/MasterKeuanganPage';
import { JamaahPage } from './pages/JamaahPage';
import { JamaahDetailPage } from './pages/JamaahDetailPage';
import { DaftarWizard } from './pages/DaftarWizard';
import { PembayaranPage } from './pages/PembayaranPage';
import { InvoiceDoc } from './pages/dokumen/InvoiceDoc';
import { KwitansiDoc } from './pages/dokumen/KwitansiDoc';
import { KwitansiRefundDoc } from './pages/dokumen/KwitansiRefundDoc';
import { OperasionalPage } from './pages/OperasionalPage';
import { LaporanOperasionalPage } from './pages/LaporanOperasionalPage';
import { KeuanganLayout, KeuanganRingkasan } from './pages/keuangan/KeuanganPage';
import { InputTransaksiPage } from './pages/keuangan/InputTransaksiPage';
import { JurnalRekonsiliasiPage } from './pages/keuangan/JurnalRekonsiliasiPage';
import { CoaPage } from './pages/keuangan/CoaPage';
import { DashboardPage } from './pages/DashboardPage';
import { LaporanKeuanganPage } from './pages/LaporanKeuanganPage';
import { PortalPage } from './pages/portal/PortalPage';
import { AgenPortalPage } from './pages/portal/AgenPortalPage';
import { AdminPage } from './pages/AdminPage';
import { MarketingPage } from './pages/MarketingPage';
import { KebijakanPrivasi } from './pages/KebijakanPrivasi';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider harus di dalam QueryClientProvider: ia membersihkan cache saat login/logout. */}
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/daftar" element={<DaftarWizard />} />
            <Route path="/portal" element={<PortalPage />} />
            <Route path="/portal-agen" element={<AgenPortalPage />} />
            <Route path="/kebijakan-privasi" element={<KebijakanPrivasi />} />
            <Route element={<RequireAuth />}>
              {/* Dokumen A4 printable — di luar AppShell & di luar NAV.
                  SEC-03: dulu "cukup login", sehingga marketing/operasional bisa membuka
                  invoice & kwitansi siapa pun. Kini dipagari role yang sama dengan
                  `requireRoles('keuangan','pimpinan')` di backend. */}
              <Route element={<RequireAuth roles={PAYMENT_DOC_ROLES} />}>
                <Route path="/dokumen/invoice/:id" element={<InvoiceDoc />} />
                <Route path="/dokumen/kwitansi/:id" element={<KwitansiDoc />} />
              </Route>
              {/* Kwitansi refund dibatasi role, sama dengan GET /v1/refunds/:id/receipt. */}
              <Route element={<RequireAuth roles={REFUND_RECEIPT_ROLES} />}>
                <Route path="/dokumen/refund/:id" element={<KwitansiRefundDoc />} />
              </Route>
              <Route element={<AppShell />}>
                {/* Dashboard terbuka untuk semua role staf (NAV '/'); tanpa guard role agar tak ada redirect berulang ke '/'. */}
                <Route path="/" element={<DashboardPage />} />
                {/* Guard role per halaman — sumber: NAV di routes/access.ts (sama dengan sidebar). */}
                <Route element={<RequireAuth roles={rolesFor('/laporan-keuangan')} />}>
                  <Route path="/laporan-keuangan" element={<LaporanKeuanganPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/admin')} />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/paket')} />}>
                  <Route path="/paket" element={<PaketPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/paket/master')} />}>
                  <Route path="/paket/master" element={<MasterPaketPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/keuangan-master')} />}>
                  <Route path="/keuangan-master" element={<MasterKeuanganPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/jamaah')} />}>
                  <Route path="/jamaah" element={<JamaahPage />} />
                  <Route path="/jamaah/:id" element={<JamaahDetailPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/pembayaran')} />}>
                  <Route path="/pembayaran" element={<PembayaranPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/operasional')} />}>
                  <Route path="/operasional" element={<OperasionalPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/laporan-operasional')} />}>
                  <Route path="/laporan-operasional" element={<LaporanOperasionalPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/marketing')} />}>
                  <Route path="/marketing" element={<MarketingPage />} />
                </Route>
                <Route element={<RequireAuth roles={rolesFor('/keuangan')} />}>
                  <Route path="/keuangan" element={<KeuanganLayout />}>
                    <Route index element={<KeuanganRingkasan />} />
                    {/* Input Transaksi = halaman tulis → pimpinan (read-only) tidak boleh (FE-03). */}
                    <Route element={<RequireAuth roles={FINANCE_WRITE_ROLES} />}>
                      <Route path="input" element={<InputTransaksiPage />} />
                    </Route>
                    <Route path="jurnal" element={<JurnalRekonsiliasiPage />} />
                    <Route path="coa" element={<CoaPage />} />
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
