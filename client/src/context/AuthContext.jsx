import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  onSessionExpired,
  refreshAccessToken,
  setAccessToken
} from '../services/api.js';

export const AuthContext = createContext(null);

let bootstrapPromise = null;

async function bootstrapSession() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const refreshed = await refreshAccessToken();
      if (refreshed?.user) return refreshed.user;
      // Fallback for same-site deployments where the SPA access cookie survived.
      try {
        const data = await api.me();
        return data.user;
      } catch {
        return null;
      }
    })();
  }
  return bootstrapPromise;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Restore the session on load using the httpOnly refresh cookie. The request
  // is memoised so React StrictMode's double effect (or a fast remount) can
  // never rotate the refresh token twice and trip replay protection.
  useEffect(() => {
    let active = true;
    bootstrapSession().then((restoredUser) => {
      if (!active) return;
      if (restoredUser) {
        setUser(restoredUser);
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
      }
    });

    const unsubscribe = onSessionExpired(() => {
      if (active) clearSession();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clearSession]);

  const login = useCallback(async (identifier, password) => {
    const data = await api.login({ identifier, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.register(payload);
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* even if the request fails, clear the local session */
    }
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      return data.user;
    } catch {
      return null;
    }
  }, []);

  const updateUser = useCallback((next) => {
    setUser((current) => (typeof next === 'function' ? next(current) : { ...current, ...next }));
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated' && Boolean(user),
      login,
      register,
      logout,
      refreshUser,
      updateUser,
      clearSession
    }),
    [user, status, login, register, logout, refreshUser, updateUser, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

export default AuthContext;
