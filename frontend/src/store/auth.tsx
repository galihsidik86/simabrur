import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAccessToken, refreshSession } from '../api/client';

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
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
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

    const onLogout = () => setUser(null);
    window.addEventListener('safar:logout', onLogout);
    return () => {
      alive = false;
      window.removeEventListener('safar:logout', onLogout);
    };
  }, []);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('safar.refresh', data.data.refreshToken);
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
  }

  function logout() {
    const refreshToken = localStorage.getItem('safar.refresh');
    if (refreshToken) api.post('/auth/logout', { refreshToken }).catch(() => {});
    localStorage.removeItem('safar.refresh');
    setAccessToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}
