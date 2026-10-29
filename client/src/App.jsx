import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.jsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.jsx';
import { ChatPage } from './pages/ChatPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { NotFoundPage } from './pages/NotFoundPage.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Brand } from './components/Brand.jsx';

function BootSplash({ label = 'Restoring your session…' }) {
  return (
    <div className="empty-state" style={{ minHeight: '100dvh' }}>
      <div className="empty-state__inner" aria-live="polite">
        <Brand />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, color: 'var(--text-muted)' }}>
          <span className="spinner" aria-hidden />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <BootSplash />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <BootSplash label="Checking administrator access…" />;
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (user?.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        }
      />
      {/* Kept so existing bookmarks/links to the old admin URL still work. */}
      <Route
        path="/app/admin"
        element={
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
