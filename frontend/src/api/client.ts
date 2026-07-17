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

/** Refresh otomatis sekali saat 401, lalu ulangi request. */
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried) {
      original._retried = true;
      refreshing ??= tryRefresh().finally(() => (refreshing = null));
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);

async function tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('safar.refresh');
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post('/v1/auth/refresh', { refreshToken });
    localStorage.setItem('safar.refresh', data.data.refreshToken);
    setAccessToken(data.data.accessToken);
    return data.data.accessToken;
  } catch {
    localStorage.removeItem('safar.refresh');
    setAccessToken(null);
    window.dispatchEvent(new Event('safar:logout'));
    return null;
  }
}
