import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, AtSign, Loader2 } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { TextField } from '../components/TextField.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState(location.state?.identifier || '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(location.state?.notice || '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/app', { replace: true });
  }, [isAuthenticated, navigate]);

  async function onSubmit(event) {
    event.preventDefault();
    setFormError('');
    const nextErrors = {};
    if (!identifier.trim()) nextErrors.identifier = 'Enter your email or username';
    if (!password) nextErrors.password = 'Enter your password';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      navigate('/app', { replace: true });
    } catch (error) {
      setErrors(error.details || {});
      setFormError(error.message || 'Could not sign you in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          New to Connectly? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <div className="auth__card-header">
        <h2>Welcome back</h2>
        <p>Sign in to pick up your conversations.</p>
      </div>

      {formError ? (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={17} aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email or username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          error={errors.identifier}
          icon={AtSign}
          autoComplete="username"
          placeholder="you@example.com"
          disabled={submitting}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          autoComplete="current-password"
          disabled={submitting}
        />
        <div className="form__row">
          <span className="field__hint">Sessions last 30 days on this device.</span>
          <Link to="/forgot-password" className="field__hint">
            Forgot password?
          </Link>
        </div>
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? <Loader2 size={17} className="spin" aria-hidden /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}

export default LoginPage;
