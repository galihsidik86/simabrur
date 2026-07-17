import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import axios from 'axios';
import { api, setAccessToken } from '../api/client';

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
    // Pulihkan sesi dari refresh token saat reload
    const refreshToken = localStorage.getItem('safar.refresh');
    if (!refreshToken) return setLoading(false);
    axios
      .post('/v1/auth/refresh', { refreshToken })
      .then(({ data }) => {
        localStorage.setItem('safar.refresh', data.data.refreshToken);
        setAccessToken(data.data.accessToken);
        setUser(data.data.user);
      })
      .catch(() => localStorage.removeItem('safar.refresh'))
      .finally(() => setLoading(false));

    const onLogout = () => setUser(null);
    window.addEventListener('safar:logout', onLogout);
    return () => window.removeEventListener('safar:logout', onLogout);
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
