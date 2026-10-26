import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, AtSign, Loader2, Mail, UserRound } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout.jsx';
import { TextField } from '../components/TextField.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { passwordStrength } from '../lib/format.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/app', { replace: true });
  }, [isAuthenticated, navigate]);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function validate() {
    const next = {};
    const username = form.username.trim();

    if (username.length < 3) next.username = 'Username must be at least 3 characters';
    else if (username.length > 24) next.username = 'Username must be at most 24 characters';
    else if (!USERNAME_PATTERN.test(username)) {
      next.username = 'Use letters, numbers, dots and underscores only';
    }

    if (!form.email.trim()) next.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      next.email = 'Enter a valid email address';
    }

    if (form.password.length < 8) next.password = 'Password must be at least 8 characters';
    else if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      next.password = 'Use at least one letter and one number';
    }

    if (form.confirmPassword !== form.password) next.confirmPassword = 'Passwords do not match';

    return next;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setFormError('');
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.confirmPassword
      });
      navigate('/app', { replace: true });
    } catch (error) {
      setErrors(error.details || {});
      setFormError(error.message || 'Could not create your account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <div className="auth__card-header">
        <h2>Create your account</h2>
        <p>Pick a unique username. That is how people will find you.</p>
      </div>

      {formError ? (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={17} aria-hidden />
          <span>{formError}</span>
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit} noValidate>
        <TextField
          label="Username"
          value={form.username}
          onChange={update('username')}
          error={errors.username}
          icon={UserRound}
          autoComplete="username"
          placeholder="aarav.sharma"
          hint="3–24 characters"
          maxLength={24}
          disabled={submitting}
        />
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={update('email')}
          error={errors.email}
          icon={Mail}
          autoComplete="email"
          placeholder="you@example.com"
          disabled={submitting}
        />
        <PasswordField
          label="Password"
          value={form.password}
          onChange={update('password')}
          error={errors.password}
          autoComplete="new-password"
          hint="8+ characters"
          showStrength
          strength={strength}
          disabled={submitting}
        />
        <PasswordField
          label="Confirm password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          error={errors.confirmPassword}
          autoComplete="new-password"
          disabled={submitting}
        />
        <p className="field__hint">
          By creating an account you agree to keep conversations respectful. We store your messages so your
          history is available on every device.
        </p>
        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? <Loader2 size={17} className="spin" aria-hidden /> : null}
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}

export default RegisterPage;
