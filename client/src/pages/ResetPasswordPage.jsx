import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { api } from '../services/api.js';
import { passwordStrength } from '../lib/format.js';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const strength = useMemo(() => passwordStrength(password), [password]);

  async function onSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (password.length < 8) nextErrors.password = 'Password must be at least 8 characters';
    if (password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    setFormError('');
    try {
      await api.resetPassword({ token, password, confirmPassword });
      navigate('/login', {
        replace: true,
        state: { notice: 'Password reset. Sign in with your new password.' }
      });
    } catch (error) {
      setErrors(error.details || {});
      setFormError(error.message || 'Could not reset your password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          Need a new link? <Link to="/forgot-password">Request another one</Link>
        </>
      }
    >
      <div className="auth__card-header">
        <h2>Choose a new password</h2>
        <p>Resetting your password signs you out of all other devices.</p>
      </div>

      {!token ? (
        <div className="alert alert--error">
          <AlertCircle size={17} aria-hidden />
          <span>This reset link is missing its token. Request a new link to continue.</span>
        </div>
      ) : null}

      {formError ? (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={17} aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit} noValidate>
        <PasswordField
          label="New password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          autoComplete="new-password"
          showStrength
          strength={strength}
          hint="8+ characters"
          disabled={submitting || !token}
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={errors.confirmPassword}
          autoComplete="new-password"
          disabled={submitting || !token}
        />
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting || !token}>
          {submitting ? <Loader2 size={17} className="spin" aria-hidden /> : null}
          {submitting ? 'Saving…' : 'Reset password'}
        </button>
      </form>
    </AuthLayout>
  );
}

export default ResetPasswordPage;
