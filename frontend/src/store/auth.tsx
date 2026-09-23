import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setAccessToken, refreshSession, logoutSession } from '../api/client';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  branch: string;
  permissions: Record<string, unknown>;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);

/** Wajib dirender DI DALAM QueryClientProvider (App.tsx) — cache dibersihkan saat ganti sesi. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Pulihkan sesi dari refresh token saat reload — lewat singleton terdedup
    // di client.ts agar StrictMode (efek dua kali) & tab lain tak saling balap.
    let alive = true;
    refreshSession()
      .then((data) => {
        if (alive && data) setUser(data.user);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // Sesi berakhir paksa (refresh gagal): buang cache agar data user ini tak
    // tampil ke user berikutnya di tab yang sama (NEW-FE-01).
    const onLogout = () => {
      queryClient.clear();
      setUser(null);
    };
    window.addEventListener('safar:logout', onLogout);
    return () => {
      alive = false;
      window.removeEventListener('safar:logout', onLogout);
    };
  }, [queryClient]);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    // SEC-07: refresh token tidak lagi ikut di body — backend menyetelnya sebagai
    // cookie httpOnly pada respons ini. Hanya access token (umur pendek) yang
    // disimpan di memori; tidak ada kredensial di localStorage lagi.
    setAccessToken(data.data.accessToken);
    queryClient.clear();
    setUser(data.data.user);
  }

  async function logout() {
    await logoutSession();
    queryClient.clear();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
