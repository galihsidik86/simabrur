import axios from 'axios';

export const api = axios.create({ baseURL: '/v1' });

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
  refreshToken: string;
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
  const message = (e as { response?: { data?: { error?: { message?: unknown } } } })?.response?.data?.error?.message;
  return typeof message === 'string' && message ? message : fallback;
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
  const refreshToken = localStorage.getItem('safar.refresh');
  try {
    if (refreshToken) {
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
      // Batas waktu: server yang menggantung tak boleh membuat tombol "Keluar" macet.
      await axios.post('/v1/auth/logout', { refreshToken }, { headers, timeout: LOGOUT_TIMEOUT_MS });
    }
  } catch {
    // Server tak terjangkau / token sudah tak berlaku — sesi lokal tetap diakhiri di bawah.
  } finally {
    localStorage.removeItem('safar.refresh');
    setAccessToken(null);
  }
}

async function doRefresh(): Promise<RefreshResult | null> {
  const refreshToken = localStorage.getItem('safar.refresh');
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post('/v1/auth/refresh', { refreshToken });
    localStorage.setItem('safar.refresh', data.data.refreshToken);
    setAccessToken(data.data.accessToken);
    return data.data as RefreshResult;
  } catch {
    // Compare-and-swap: hanya bersihkan sesi bila token tersimpan masih token
    // yang kita coba. Bila refresh lain (tab lain / request paralel) sudah
    // merotasinya, 401 kita adalah replay yang tak berbahaya — jangan hapus
    // token segar milik sesi yang sah.
    if (localStorage.getItem('safar.refresh') === refreshToken) {
      localStorage.removeItem('safar.refresh');
      setAccessToken(null);
      window.dispatchEvent(new Event('safar:logout'));
    }
    return null;
  }
}
