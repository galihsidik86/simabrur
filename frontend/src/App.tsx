import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './store/auth';
import { RequireAuth } from './routes/RequireAuth';
import { AppShell } from './layouts/AppShell';
import { Login } from './pages/Login';
import { PaketPage } from './pages/PaketPage';
import { MasterPaketPage } from './pages/MasterPaketPage';
import { JamaahPage } from './pages/JamaahPage';
import { JamaahDetailPage } from './pages/JamaahDetailPage';
import { DaftarWizard } from './pages/DaftarWizard';
import { PembayaranPage } from './pages/PembayaranPage';
import { InvoiceDoc } from './pages/dokumen/InvoiceDoc';
import { KwitansiDoc } from './pages/dokumen/KwitansiDoc';
import { OperasionalPage } from './pages/OperasionalPage';
import { LaporanOperasionalPage } from './pages/LaporanOperasionalPage';
import { KeuanganLayout, KeuanganRingkasan } from './pages/keuangan/KeuanganPage';
import { InputTransaksiPage } from './pages/keuangan/InputTransaksiPage';
import { JurnalRekonsiliasiPage } from './pages/keuangan/JurnalRekonsiliasiPage';
import { CoaPage } from './pages/keuangan/CoaPage';
import { DashboardPage } from './pages/DashboardPage';
import { LaporanKeuanganPage } from './pages/LaporanKeuanganPage';
import { PortalPage } from './pages/portal/PortalPage';
import { AdminPage } from './pages/AdminPage';
import { MarketingPage } from './pages/MarketingPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/daftar" element={<DaftarWizard />} />
            <Route path="/portal" element={<PortalPage />} />
            <Route element={<RequireAuth />}>
              {/* Dokumen A4 printable — di luar AppShell */}
              <Route path="/dokumen/invoice/:id" element={<InvoiceDoc />} />
              <Route path="/dokumen/kwitansi/:id" element={<KwitansiDoc />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/laporan-keuangan" element={<LaporanKeuanganPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/paket" element={<PaketPage />} />
                <Route path="/paket/master" element={<MasterPaketPage />} />
                <Route path="/jamaah" element={<JamaahPage />} />
                <Route path="/jamaah/:id" element={<JamaahDetailPage />} />
                <Route path="/pembayaran" element={<PembayaranPage />} />
                <Route path="/operasional" element={<OperasionalPage />} />
                <Route path="/laporan-operasional" element={<LaporanOperasionalPage />} />
                <Route path="/marketing" element={<MarketingPage />} />
                <Route path="/keuangan" element={<KeuanganLayout />}>
                  <Route index element={<KeuanganRingkasan />} />
                  <Route path="input" element={<InputTransaksiPage />} />
                  <Route path="jurnal" element={<JurnalRekonsiliasiPage />} />
                  <Route path="coa" element={<CoaPage />} />
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
