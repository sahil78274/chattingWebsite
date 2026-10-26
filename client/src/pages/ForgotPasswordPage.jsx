import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { TextField } from '../components/TextField.jsx';
import { api } from '../services/api.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setSubmitting(true);
    try {
      const data = await api.forgotPassword(email.trim());
      setResult(data);
    } catch (requestError) {
      setError(requestError.message || 'Could not start the reset');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          Remembered it? <Link to="/login">Back to sign in</Link>
        </>
      }
    >
      <div className="auth__card-header">
        <h2>Reset your password</h2>
        <p>Enter the email on your account and we will send a reset link.</p>
      </div>

      {result ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="alert alert--success">
            <CheckCircle2 size={17} aria-hidden />
            <span>{result.message}</span>
          </div>
          {result.emailDelivery === 'not_configured' ? (
            <div className="alert alert--info">
              <AlertCircle size={17} aria-hidden />
              <span>
                Email delivery is not configured on this deployment (no SMTP credentials). Set SMTP_HOST,
                SMTP_USER and SMTP_PASS on the API server to enable it — see the README.
              </span>
            </div>
          ) : null}
          {result.devResetUrl ? (
            <div className="alert alert--info" style={{ display: 'grid', gap: 6 }}>
              <span>Development reset link:</span>
              <Link to={result.devResetUrl.replace(/^https?:\/\/[^/]+/, '')} style={{ wordBreak: 'break-all' }}>
                {result.devResetUrl}
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <form className="form" onSubmit={onSubmit} noValidate>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={error}
            icon={Mail}
            autoComplete="email"
            placeholder="you@example.com"
            disabled={submitting}
          />
          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? <Loader2 size={17} className="spin" aria-hidden /> : null}
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="field__hint">
            For security we always show the same confirmation, whether or not an account exists.
          </p>
        </form>
      )}
    </AuthLayout>
  );
}

export default ForgotPasswordPage;
