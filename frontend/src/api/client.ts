import axios from 'axios';

/**
 * QA-05: TANPA `timeout`, menyimpan data saat koneksi putus membuat browser mengantre
 * request tanpa batas — tombol tertahan di "Menyimpan…" selamanya dan pengguna tidak
 * diberi tahu apa pun. Dengan batas waktu, axios melempar `ECONNABORTED` sehingga
 * halaman bisa menampilkan pesan (lihat `apiErrorMessage`).
 *
 * 30 detik: jauh di atas request normal (terlama ±2 dtk), tapi masih terasa sebagai
 * kegagalan, bukan menggantung. Unggah berkas TIDAK lewat instance ini (memakai `axios`
 * polos dengan FormData), jadi batas ini tidak memotong unggahan di jaringan lambat.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export const api = axios.create({ baseURL: '/v1', timeout: REQUEST_TIMEOUT_MS });

let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

export interface RefreshResult {
  accessToken: string;
  // SEC-07: `refreshToken` sengaja TIDAK ada di sini. Backend tidak lagi mengirimkannya
  // dalam body — ia hanya hidup sebagai cookie httpOnly yang tak terbaca JavaScript.
  user: import('../store/auth').User;
}

/**
 * Refresh token dideduplikasi lewat satu promise in-flight: berapa pun pemanggil
 * bersamaan (interceptor 401, pemulihan sesi saat reload, StrictMode yang
 * memicu efek dua kali) berbagi satu request /auth/refresh. Tanpa ini, dua
 * refresh paralel dgn token sama → satu 200 (rotasi token) + satu 401, dan
 * penanganan 401 bisa menghapus token segar yang baru ditulis refresh sukses.
 */
let refreshing: Promise<RefreshResult | null> | null = null;

export function refreshSession(): Promise<RefreshResult | null> {
  refreshing ??= doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried) {
      original._retried = true;
      const data = await refreshSession();
      if (data) {
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);

/** Pesan error dari envelope backend `{success:false,error:{code,message}}`. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as { code?: string; response?: { data?: { error?: { message?: unknown } } } };
  const message = err?.response?.data?.error?.message;
  if (typeof message === 'string' && message) return message;

  // QA-05: tanpa `response` berarti request tidak pernah sampai ke server — koneksi
  // putus atau melewati batas waktu. `fallback` biasanya berbunyi seperti "Gagal
  // menyimpan pembayaran", yang menyesatkan di sini: tidak ada yang gagal di server,
  // datanya justru belum terkirim sama sekali.
  if (!err?.response) {
    return err?.code === 'ECONNABORTED'
      ? 'Server tidak merespons dalam 30 detik. Data belum tersimpan — periksa koneksi lalu coba lagi.'
      : 'Tidak dapat terhubung ke server. Data belum tersimpan — periksa koneksi lalu coba lagi.';
  }
  return fallback;
}

/**
 * Cabut refresh token di server SEBELUM sesi lokal dibersihkan (NEW-FE-02).
 * Memakai axios polos (bukan `api`) agar 401 tidak memicu refreshSession — rotasi
 * di tengah logout akan mencabut token lama sementara token baru tetap aktif.
 * Refresh yang sedang berjalan ditunggu dulu supaya yang dicabut token terbaru.
 * Gagal jaringan/401 tidak menghalangi logout lokal.
 */
const LOGOUT_TIMEOUT_MS = 5_000;

export async function logoutSession(): Promise<void> {
  if (refreshing) await refreshing;
  try {
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    // SEC-07: tanpa body — cookie httpOnly yang otomatis dikirim browser ADALAH
    // kredensialnya. Batas waktu: server yang menggantung tak boleh membuat tombol
    // "Keluar" macet. Backend selalu 200 dan selalu menghapus cookie-nya.
    await axios.post('/v1/auth/logout', null, { headers, timeout: LOGOUT_TIMEOUT_MS });
  } catch {
    // Server tak terjangkau / sesi sudah berakhir — sesi lokal tetap diakhiri di bawah.
  } finally {
    setAccessToken(null);
  }
}

/** Jeda sebelum percobaan kedua — lihat penjelasan balapan antar-tab di `doRefresh`. */
const REFRESH_RETRY_DELAY_MS = 200;

async function postRefresh(): Promise<RefreshResult> {
  // SEC-07: tanpa body. Cookie `safar.refresh` ber-path `/v1/auth` ikut terkirim sendiri.
  const { data } = await axios.post('/v1/auth/refresh', null, { timeout: REQUEST_TIMEOUT_MS });
  setAccessToken(data.data.accessToken);
  return data.data as RefreshResult;
}

async function doRefresh(): Promise<RefreshResult | null> {
  // Ada sesi berjalan di tab ini? Menentukan apakah kegagalan pertama layak dicoba ulang.
  const hadSession = accessToken !== null;
  try {
    return await postRefresh();
  } catch {
    if (hadSession) {
      // Dua tab me-refresh bersamaan mengirim cookie yang SAMA; server mencabut token
      // lama secara atomik sehingga satu menang dan satu menerima 401. Dulu ini
      // ditangani compare-and-swap terhadap token di localStorage — dengan cookie
      // httpOnly token itu tak bisa dibaca JS lagi. Gantinya satu kali coba ulang:
      // saat itu `Set-Cookie` dari tab pemenang sudah mendarat di cookie jar yang
      // dipakai bersama, jadi percobaan kedua membawa token yang segar.
      await new Promise((resolve) => setTimeout(resolve, REFRESH_RETRY_DELAY_MS));
      try {
        return await postRefresh();
      } catch {
        // Percobaan kedua pun gagal → sesi memang sudah berakhir.
      }
      setAccessToken(null);
      window.dispatchEvent(new Event('safar:logout'));
    }
    // Tanpa sesi sebelumnya (mis. memuat halaman login), 401 adalah hal normal —
    // jangan memicu event logout yang membersihkan cache tanpa sebab.
    return null;
  }
}
