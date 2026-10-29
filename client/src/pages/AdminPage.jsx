import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { TextField } from '../components/TextField.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../services/api.js';
import { formatListTime } from '../lib/format.js';

export function AdminPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'user' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, list] = await Promise.all([
        api.adminOverview(),
        api.adminUsers({ q: query.trim(), status })
      ]);
      setOverview(stats);
      setUsers(list.users);
    } catch (error) {
      notify.error(error.message || 'Could not load the admin dashboard');
    } finally {
      setLoading(false);
    }
  }, [notify, query, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(target, next) {
    try {
      await api.adminSetStatus(target.id, next);
      notify.success(`@${target.username} is now ${next}`);
      load();
    } catch (error) {
      notify.error(error.message || 'Could not update that account');
    }
  }

  async function changeRole(target, role) {
    try {
      await api.adminSetRole(target.id, role);
      notify.success(`@${target.username} is now ${role}`);
      load();
    } catch (error) {
      notify.error(error.message || 'Could not change that role');
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setCreating(true);
    try {
      await api.adminCreateUser({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        confirmPassword: form.password,
        role: form.role
      });
      notify.success('Account created');
      setForm({ username: '', email: '', password: '', role: 'user' });
      load();
    } catch (error) {
      notify.error(error.message || 'Could not create that account');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page__top">
        <div className="admin-page__brand">
          <Link to="/app" className="icon-btn" aria-label="Back to chat">
            <ArrowLeft size={18} />
          </Link>
          <Brand />
          <span className="badge-soft">
            <Shield size={12} /> Admin
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="admin-page__body">
        <p className="muted">
          Signed in as @{user.username}. Ordinary members cannot open this page — every action is
          checked on the server and written to the audit log.
        </p>

        <section className="admin-stats">
          {[
            ['Accounts', overview?.counts?.total],
            ['Active', overview?.counts?.active],
            ['Suspended', overview?.counts?.suspended],
            ['Admins', overview?.counts?.admins],
            ['New (7d)', overview?.counts?.recent]
          ].map(([label, value]) => (
            <div key={label} className="admin-stat">
              <span>{label}</span>
              <strong>{value ?? '—'}</strong>
            </div>
          ))}
        </section>

        <section className="admin-panel">
          <div className="admin-panel__head">
            <h2>People</h2>
            <div className="admin-filters">
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search username, name or email"
                aria-label="Search users"
              />
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="deleted">Deleted</option>
              </select>
            </div>
          </div>

          {loading ? (
            <p className="muted">
              <Loader2 size={14} className="spin" /> Loading…
            </p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-user">
                          <Avatar user={row} size="sm" />
                          <span>
                            <strong>{row.displayName}</strong>
                            <span className="muted">@{row.username}</span>
                          </span>
                        </div>
                      </td>
                      <td>{row.email}</td>
                      <td>{row.role}</td>
                      <td>{row.status}</td>
                      <td>{row.createdAt ? formatListTime(row.createdAt) : '—'}</td>
                      <td>
                        <div className="admin-actions">
                          {row.status === 'active' ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => changeStatus(row, 'suspended')}>
                              Suspend
                            </button>
                          ) : row.status === 'suspended' ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => changeStatus(row, 'active')}>
                              Restore
                            </button>
                          ) : null}
                          {row.status !== 'deleted' ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => changeStatus(row, 'deleted')}>
                              Delete
                            </button>
                          ) : null}
                          {row.role === 'admin' ? (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => changeRole(row, 'user')}>
                              Demote
                            </button>
                          ) : (
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => changeRole(row, 'admin')}>
                              Make admin
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-panel">
          <h2>Create account</h2>
          <form className="form" onSubmit={createUser}>
            <TextField
              label="Username"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              autoComplete="off"
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              autoComplete="off"
            />
            <PasswordField
              label="Temporary password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              autoComplete="new-password"
            />
            <label className="field">
              <span className="field__label">Role</span>
              <select
                className="input"
                value={form.role}
                onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button type="submit" className="btn btn--primary" disabled={creating}>
              {creating ? <Loader2 size={16} className="spin" /> : null}
              Create
            </button>
          </form>
        </section>

        <section className="admin-panel">
          <h2>Audit log</h2>
          <ul className="audit-list">
            {(overview?.recentAudit || []).map((row) => (
              <li key={row.id}>
                <span>{row.action}</span>
                <span className="muted">{row.targetUser || '—'}</span>
                <span className="muted">{row.createdAt ? formatListTime(row.createdAt) : ''}</span>
              </li>
            ))}
            {overview && !overview.recentAudit?.length ? <li className="muted">No admin actions yet.</li> : null}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default AdminPage;
