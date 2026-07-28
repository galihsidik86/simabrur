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
