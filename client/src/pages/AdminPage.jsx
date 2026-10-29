import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutDashboard,
  Loader2,
  LogOut,
  RefreshCw,
  ScrollText,
  Shield,
  UserCog,
  Users,
  XCircle
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { TextField } from '../components/TextField.jsx';
import { PasswordField } from '../components/PasswordField.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../services/api.js';
import { useDebounce } from '../hooks/useDebounce.js';
import { formatListTime } from '../lib/format.js';

const TABS = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'moderation', label: 'Moderation', icon: Flag },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'profile', label: 'My profile', icon: UserCog }
];

const REPORT_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All reports' }
];

const EMPTY_USERS = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false, loading: true, error: '' };
const EMPTY_REPORTS = { items: [], total: 0, page: 1, pageSize: 20, hasMore: false, loading: true, error: '' };
const EMPTY_AUDIT = { items: [], total: 0, page: 1, pageSize: 30, hasMore: false, loading: true, error: '' };

function Pager({ page, pageSize, total, hasMore, disabled, onChange }) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="admin-pager">
      <span className="muted">
        {total} {total === 1 ? 'record' : 'records'} · page {page} of {pages}
      </span>
      <div className="admin-pager__buttons">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange(page + 1)}
          disabled={disabled || !hasMore}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="admin-stat">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
      {hint ? <small className="muted">{hint}</small> : null}
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`admin-pill admin-pill--${status || 'active'}`}>{status || 'active'}</span>;
}

export function AdminPage() {
  const { user, refreshUser, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [overviewState, setOverviewState] = useState({ loading: true, error: '' });

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [userStatus, setUserStatus] = useState('all');
  const [userPage, setUserPage] = useState(1);
  const [users, setUsers] = useState(EMPTY_USERS);

  const [reportStatus, setReportStatus] = useState('open');
  const [reportPage, setReportPage] = useState(1);
  const [reports, setReports] = useState(EMPTY_REPORTS);

  const [auditPage, setAuditPage] = useState(1);
  const [audit, setAudit] = useState(EMPTY_AUDIT);

  const [confirm, setConfirm] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'user' });

  const handleError = useCallback(
    async (error, fallback) => {
      const message = error?.message || fallback;
      // A 403 means the server no longer considers this account an
      // administrator (demoted). Refresh the session so the route guard can
      // react, then surface the failure.
      if (error?.status === 403 && error?.code === 'ADMIN_ONLY') await refreshUser();
      return message;
    },
    [refreshUser]
  );

  const loadOverview = useCallback(async () => {
    setOverviewState({ loading: true, error: '' });
    try {
      const data = await api.adminOverview();
      setOverview(data);
      setOverviewState({ loading: false, error: '' });
    } catch (error) {
      setOverviewState({ loading: false, error: await handleError(error, 'Could not load the dashboard') });
    }
  }, [handleError]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Verify the session against an admin-only endpoint as soon as the panel
  // mounts. A revoked/expired session (401) clears the SPA session through the
  // API client, and a demoted account (403) refreshes the user so the route
  // guard can redirect away immediately.
  useEffect(() => {
    let active = true;
    api
      .adminMe()
      .then((data) => {
        if (active && data?.user?.role !== 'admin') refreshUser();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [refreshUser]);

  // Users: server-side search + pagination, debounced so typing is cheap.
  useEffect(() => {
    if (tab !== 'users') return undefined;
    let active = true;
    setUsers((current) => ({ ...current, loading: true, error: '' }));
    api
      .adminUsers({ q: debouncedQuery.trim(), status: userStatus, page: userPage })
      .then((data) => {
        if (!active) return;
        setUsers({
          items: data.users || [],
          total: data.total || 0,
          page: data.page || userPage,
          pageSize: data.pageSize || 20,
          hasMore: Boolean(data.hasMore),
          loading: false,
          error: ''
        });
      })
      .catch(async (error) => {
        if (!active) return;
        const message = await handleError(error, 'Could not load users');
        setUsers((current) => ({ ...current, loading: false, error: message }));
      });
    return () => {
      active = false;
    };
  }, [tab, debouncedQuery, userStatus, userPage, handleError]);

  // Moderation: reports (no message bodies are ever returned by the API).
  useEffect(() => {
    if (tab !== 'moderation') return undefined;
    let active = true;
    setReports((current) => ({ ...current, loading: true, error: '' }));
    api
      .adminReports({ status: reportStatus, page: reportPage })
      .then((data) => {
        if (!active) return;
        setReports({
          items: data.reports || [],
          total: data.total || 0,
          page: data.page || reportPage,
          pageSize: data.pageSize || 20,
          hasMore: Boolean(data.hasMore),
          loading: false,
          error: ''
        });
      })
      .catch(async (error) => {
        if (!active) return;
        const message = await handleError(error, 'Could not load reports');
        setReports((current) => ({ ...current, loading: false, error: message }));
      });
    return () => {
      active = false;
    };
  }, [tab, reportStatus, reportPage, handleError]);

  useEffect(() => {
    if (tab !== 'audit') return undefined;
    let active = true;
    setAudit((current) => ({ ...current, loading: true, error: '' }));
    api
      .adminAudit(auditPage)
      .then((data) => {
        if (!active) return;
        setAudit({
          items: data.logs || [],
          total: data.total || 0,
          page: data.page || auditPage,
          pageSize: data.pageSize || 30,
          hasMore: Boolean(data.hasMore),
          loading: false,
          error: ''
        });
      })
      .catch(async (error) => {
        if (!active) return;
        const message = await handleError(error, 'Could not load the audit log');
        setAudit((current) => ({ ...current, loading: false, error: message }));
      });
    return () => {
      active = false;
    };
  }, [tab, auditPage, handleError]);

  function refreshAfterMutation() {
    loadOverview();
  }

  // Re-run the currently visible list after an action without losing filters.
  function reloadUsers() {
    api
      .adminUsers({ q: debouncedQuery.trim(), status: userStatus, page: userPage })
      .then((data) =>
        setUsers({
          items: data.users || [],
          total: data.total || 0,
          page: data.page || userPage,
          pageSize: data.pageSize || 20,
          hasMore: Boolean(data.hasMore),
          loading: false,
          error: ''
        })
      )
      .catch(async (error) => {
        const message = await handleError(error, 'Could not load users');
        setUsers((current) => ({ ...current, loading: false, error: message }));
      });
  }

  function reloadReports() {
    api
      .adminReports({ status: reportStatus, page: reportPage })
      .then((data) =>
        setReports({
          items: data.reports || [],
          total: data.total || 0,
          page: data.page || reportPage,
          pageSize: data.pageSize || 20,
          hasMore: Boolean(data.hasMore),
          loading: false,
          error: ''
        })
      )
      .catch(async (error) => {
        const message = await handleError(error, 'Could not load reports');
        setReports((current) => ({ ...current, loading: false, error: message }));
      });
  }

  async function changeStatus(target, next) {
    await api.adminSetStatus(target.id, next);
    notify.success(
      next === 'active' ? `@${target.username} was reactivated` : `@${target.username} is now ${next}`
    );
    reloadUsers();
    refreshAfterMutation();
  }

  async function changeRole(target, role) {
    await api.adminSetRole(target.id, role);
    notify.success(`@${target.username} is now ${role === 'admin' ? 'an administrator' : 'a regular user'}`);
    reloadUsers();
    refreshAfterMutation();
  }

  async function updateReport(target, status) {
    await api.adminUpdateReport(target.id, status);
    notify.success(`Report marked as ${status}`);
    reloadReports();
    refreshAfterMutation();
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
      reloadUsers();
      loadOverview();
    } catch (error) {
      notify.error(await handleError(error, 'Could not create that account'));
    } finally {
      setCreating(false);
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  const totals = overview?.totals || {};
  const counts = overview?.counts || {};
  const reportCounts = overview?.reports || {};

  const joined = useMemo(() => (user?.createdAt ? formatListTime(user.createdAt) : '—'), [user?.createdAt]);

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
        <div className="admin-page__top-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={loadOverview}
            disabled={overviewState.loading}
          >
            <RefreshCw size={14} className={overviewState.loading ? 'spin' : undefined} /> Refresh
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="admin-page__body">
        <div className="admin-identity">
          <Avatar user={user} size="sm" />
          <div className="admin-identity__meta">
            <strong>{user?.displayName || user?.username}</strong>
            <span className="muted">
              @{user?.username} · {user?.email || '—'}
            </span>
          </div>
          <span className="badge-soft">
            <Shield size={12} /> {user?.role}
          </span>
        </div>

        <nav className="admin-tabs" aria-label="Admin sections">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`admin-tab ${tab === item.id ? 'admin-tab--active' : ''}`}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>

        {overviewState.error ? (
          <div className="alert alert--error" role="alert">
            {overviewState.error}
          </div>
        ) : null}

        {tab === 'overview' ? (
          <>
            <section className="admin-stats" aria-busy={overviewState.loading}>
              <StatCard label="Registered users" value={totals.users} hint={`${counts.recent ?? 0} joined in the last 7 days`} />
              <StatCard label="Active accounts" value={counts.active} hint={`${counts.suspended ?? 0} suspended`} />
              <StatCard label="Conversations" value={totals.conversations} hint="Direct conversations in the database" />
              <StatCard label="Messages" value={totals.messages} hint="All messages ever stored" />
              <StatCard label="Open reports" value={reportCounts.open} hint={`${reportCounts.total ?? 0} reports in total`} />
              <StatCard label="Administrators" value={counts.admins} hint="Active admin accounts" />
            </section>

            <div className="admin-columns">
              <section className="admin-panel">
                <div className="admin-panel__head">
                  <h2>Recent registrations</h2>
                  <span className="muted">Latest 8 accounts</span>
                </div>
                {overviewState.loading && !overview ? (
                  <p className="muted">
                    <Loader2 size={14} className="spin" /> Loading…
                  </p>
                ) : overview?.recentRegistrations?.length ? (
                  <ul className="admin-list">
                    {overview.recentRegistrations.map((row) => (
                      <li key={row.id}>
                        <Avatar user={row} size="sm" />
                        <span>
                          <strong>{row.displayName}</strong>
                          <span className="muted">@{row.username}</span>
                        </span>
                        <span className="muted">{row.createdAt ? formatListTime(row.createdAt) : ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-empty">No registrations yet.</p>
                )}
              </section>

              <section className="admin-panel">
                <div className="admin-panel__head">
                  <h2>Recent administrator activity</h2>
                  <span className="muted">{overview?.auditTotal ?? 0} actions logged</span>
                </div>
                {overview?.recentAudit?.length ? (
                  <ul className="audit-list">
                    {overview.recentAudit.map((row) => (
                      <li key={row.id}>
                        <span>{row.action}</span>
                        <span className="muted">{row.targetUser || '—'}</span>
                        <span className="muted">{row.createdAt ? formatListTime(row.createdAt) : ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-empty">
                    {overviewState.loading ? 'Loading…' : 'No administrator actions recorded yet.'}
                  </p>
                )}
              </section>
            </div>
          </>
        ) : null}

        {tab === 'users' ? (
          <>
            <section className="admin-panel">
              <div className="admin-panel__head">
                <h2>User management</h2>
                <div className="admin-filters">
                  <input
                    className="input"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setUserPage(1);
                    }}
                    placeholder="Search username, name or exact email"
                    aria-label="Search users"
                  />
                  <select
                    className="input"
                    value={userStatus}
                    onChange={(event) => {
                      setUserStatus(event.target.value);
                      setUserPage(1);
                    }}
                    aria-label="Filter by account status"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="deleted">Deleted</option>
                  </select>
                </div>
              </div>

              {users.error ? <div className="alert alert--error" role="alert">{users.error}</div> : null}

              {users.loading ? (
                <p className="muted">
                  <Loader2 size={14} className="spin" /> Loading users…
                </p>
              ) : users.items.length ? (
                <>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th className="admin-col-email">Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Joined</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.items.map((row) => {
                          const isSelf = row.id === user?.id;
                          return (
                            <tr key={row.id}>
                              <td>
                                <div className="admin-user">
                                  <Avatar user={row} size="sm" />
                                  <span>
                                    <strong>{row.displayName}</strong>
                                    <span className="muted">
                                      @{row.username}
                                      {isSelf ? ' · you' : ''}
                                    </span>
                                  </span>
                                </div>
                              </td>
                              <td className="admin-col-email">{row.email}</td>
                              <td>{row.role}</td>
                              <td>
                                <StatusPill status={row.status} />
                              </td>
                              <td>{row.createdAt ? formatListTime(row.createdAt) : '—'}</td>
                              <td>
                                <div className="admin-actions">
                                  {row.status === 'active' ? (
                                    <button
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      disabled={isSelf}
                                      onClick={() =>
                                        setConfirm({
                                          title: 'Suspend this account?',
                                          message: `@${row.username} will be signed out and blocked from signing in until reactivated.`,
                                          confirmLabel: 'Suspend account',
                                          destructive: true,
                                          action: () => changeStatus(row, 'suspended')
                                        })
                                      }
                                    >
                                      Suspend
                                    </button>
                                  ) : null}
                                  {row.status === 'suspended' ? (
                                    <button
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      onClick={() =>
                                        setConfirm({
                                          title: 'Reactivate this account?',
                                          message: `@${row.username} will be able to sign in and use Connectly again.`,
                                          confirmLabel: 'Reactivate',
                                          destructive: false,
                                          action: () => changeStatus(row, 'active')
                                        })
                                      }
                                    >
                                      Reactivate
                                    </button>
                                  ) : null}
                                  {row.status !== 'deleted' ? (
                                    <button
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      disabled={isSelf}
                                      onClick={() =>
                                        setConfirm({
                                          title: 'Delete this account?',
                                          message: `@${row.username} will be signed out and can no longer sign in. Existing messages remain in the database.`,
                                          confirmLabel: 'Delete account',
                                          destructive: true,
                                          action: () => changeStatus(row, 'deleted')
                                        })
                                      }
                                    >
                                      Delete
                                    </button>
                                  ) : null}
                                  {row.role === 'admin' ? (
                                    <button
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      disabled={isSelf}
                                      onClick={() =>
                                        setConfirm({
                                          title: 'Remove administrator access?',
                                          message: `@${row.username} will immediately lose access to the admin panel and its APIs.`,
                                          confirmLabel: 'Demote to user',
                                          destructive: true,
                                          action: () => changeRole(row, 'user')
                                        })
                                      }
                                    >
                                      Demote
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn--ghost btn--sm"
                                      disabled={isSelf || row.status !== 'active'}
                                      onClick={() =>
                                        setConfirm({
                                          title: 'Grant administrator access?',
                                          message: `@${row.username} will be able to view all accounts, suspend users and moderate reports.`,
                                          confirmLabel: 'Make admin',
                                          destructive: true,
                                          action: () => changeRole(row, 'admin')
                                        })
                                      }
                                    >
                                      Make admin
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    page={users.page}
                    pageSize={users.pageSize}
                    total={users.total}
                    hasMore={users.hasMore}
                    disabled={users.loading}
                    onChange={setUserPage}
                  />
                </>
              ) : (
                <p className="admin-empty">
                  {debouncedQuery.trim() || userStatus !== 'all'
                    ? 'No accounts match these filters.'
                    : 'No accounts yet.'}
                </p>
              )}
            </section>

            <section className="admin-panel">
              <details>
                <summary className="admin-summary">Create an account manually</summary>
                <form className="admin-form" onSubmit={createUser}>
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
                  <div className="admin-form__actions">
                    <button type="submit" className="btn btn--primary" disabled={creating}>
                      {creating ? <Loader2 size={16} className="spin" /> : null}
                      Create account
                    </button>
                  </div>
                </form>
              </details>
            </section>
          </>
        ) : null}

        {tab === 'moderation' ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <h2>Reports</h2>
              <div className="admin-filters">
                <select
                  className="input"
                  value={reportStatus}
                  onChange={(event) => {
                    setReportStatus(event.target.value);
                    setReportPage(1);
                  }}
                  aria-label="Filter reports by status"
                >
                  {REPORT_STATUSES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="muted admin-note">
              Reports are submitted by members from the chat UI. Only the reporter&apos;s own description is
              shown here — private message contents are never loaded into the admin panel.
            </p>

            {reports.error ? <div className="alert alert--error" role="alert">{reports.error}</div> : null}

            {reports.loading ? (
              <p className="muted">
                <Loader2 size={14} className="spin" /> Loading reports…
              </p>
            ) : reports.items.length ? (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Reported</th>
                        <th>Reporter</th>
                        <th>Reason</th>
                        <th>Details</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.items.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>@{row.reportedUser?.username || 'deleted'}</strong>
                          </td>
                          <td className="muted">@{row.reporter?.username || 'deleted'}</td>
                          <td>{row.reason}</td>
                          <td>
                            <span className="admin-report-details" title={row.details || ''}>
                              {row.details || <span className="muted">—</span>}
                            </span>
                          </td>
                          <td>
                            <StatusPill status={row.status} />
                          </td>
                          <td className="muted">{row.createdAt ? formatListTime(row.createdAt) : '—'}</td>
                          <td>
                            <div className="admin-actions">
                              {row.status !== 'reviewed' ? (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() =>
                                    setConfirm({
                                      title: 'Mark this report as reviewed?',
                                      message: 'The report stays in the audit trail and can be reopened later.',
                                      confirmLabel: 'Mark reviewed',
                                      destructive: false,
                                      action: () => updateReport(row, 'reviewed')
                                    })
                                  }
                                >
                                  <CheckCircle2 size={14} /> Reviewed
                                </button>
                              ) : null}
                              {row.status !== 'closed' ? (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() =>
                                    setConfirm({
                                      title: 'Close this report?',
                                      message: 'Closing records that no further action is planned for this report.',
                                      confirmLabel: 'Close report',
                                      destructive: true,
                                      action: () => updateReport(row, 'closed')
                                    })
                                  }
                                >
                                  <XCircle size={14} /> Close
                                </button>
                              ) : null}
                              {row.status !== 'open' ? (
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  onClick={() =>
                                    setConfirm({
                                      title: 'Reopen this report?',
                                      message: 'The report returns to the open queue for another look.',
                                      confirmLabel: 'Reopen',
                                      destructive: false,
                                      action: () => updateReport(row, 'open')
                                    })
                                  }
                                >
                                  Reopen
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={reports.page}
                  pageSize={reports.pageSize}
                  total={reports.total}
                  hasMore={reports.hasMore}
                  disabled={reports.loading}
                  onChange={setReportPage}
                />
              </>
            ) : (
              <p className="admin-empty">
                {reportStatus === 'open'
                  ? 'No open reports. Nothing needs attention right now.'
                  : 'No reports match this filter.'}
              </p>
            )}
          </section>
        ) : null}

        {tab === 'audit' ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <h2>Audit log</h2>
              <span className="muted">Every administrative action is recorded server-side</span>
            </div>
            {audit.error ? <div className="alert alert--error" role="alert">{audit.error}</div> : null}
            {audit.loading ? (
              <p className="muted">
                <Loader2 size={14} className="spin" /> Loading audit log…
              </p>
            ) : audit.items.length ? (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Actor</th>
                        <th>Target</th>
                        <th>Details</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.items.map((row) => (
                        <tr key={row.id}>
                          <td>{row.action}</td>
                          <td className="muted">{row.actor || '—'}</td>
                          <td className="muted">{row.targetUser || '—'}</td>
                          <td className="muted">
                            {row.metadata && Object.keys(row.metadata).length
                              ? Object.entries(row.metadata)
                                  .map(([key, value]) => `${key}: ${String(value)}`)
                                  .join(' · ')
                              : '—'}
                          </td>
                          <td className="muted">{row.createdAt ? formatListTime(row.createdAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={audit.page}
                  pageSize={audit.pageSize}
                  total={audit.total}
                  hasMore={audit.hasMore}
                  disabled={audit.loading}
                  onChange={setAuditPage}
                />
              </>
            ) : (
              <p className="admin-empty">No administrator actions recorded yet.</p>
            )}
          </section>
        ) : null}

        {tab === 'profile' ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <h2>Administrator profile</h2>
              <span className="badge-soft">
                <Shield size={12} /> Verified by the server on every request
              </span>
            </div>
            <div className="admin-profile">
              <Avatar user={user} size="lg" />
              <div className="admin-profile__details">
                <div className="admin-profile__row">
                  <span className="muted">Display name</span>
                  <strong>{user?.displayName || '—'}</strong>
                </div>
                <div className="admin-profile__row">
                  <span className="muted">Username</span>
                  <strong>@{user?.username}</strong>
                </div>
                <div className="admin-profile__row">
                  <span className="muted">Email</span>
                  <strong>{user?.email || '—'}</strong>
                </div>
                <div className="admin-profile__row">
                  <span className="muted">Role</span>
                  <strong>{user?.role}</strong>
                </div>
                <div className="admin-profile__row">
                  <span className="muted">Account status</span>
                  <StatusPill status={user?.status} />
                </div>
                <div className="admin-profile__row">
                  <span className="muted">Member since</span>
                  <strong>{joined}</strong>
                </div>
              </div>
            </div>
            <div className="admin-profile__actions">
              <Link to="/app" className="btn btn--secondary">
                Back to chat
              </Link>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() =>
                  setConfirm({
                    title: 'Sign out of the admin panel?',
                    message: 'You will be signed out of Connectly on this device.',
                    confirmLabel: 'Sign out',
                    destructive: true,
                    action: signOut
                  })
                }
              >
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </section>
        ) : null}
      </main>

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

export default AdminPage;
