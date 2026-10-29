import { Brand } from './Brand.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

export function AuthLayout({ children, footer }) {
  return (
    <div className="auth">
      <aside className="auth__aside" aria-hidden={false}>
        <div>
          <Brand />
          <div className="auth__eyebrow">Secure messaging</div>
          <h1>Private conversations, built for real teams.</h1>
          <p className="auth__lede">
            Find people by username, start a direct thread, and stay in sync with instant delivery and read receipts.
          </p>

          <div className="auth__features">
            <div className="auth__feature">
              <span className="auth__feature-icon" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M22 12h-6l-3 7-4-14-3 7H2" /></svg>
              </span>
              <div>
                <h3>Real-time, reliable</h3>
                <p>Messages persist first, then deliver. No refresh required.</p>
              </div>
            </div>
            <div className="auth__feature">
              <span className="auth__feature-icon" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="11" width="16" height="11" rx="2"/><path d="M7 11V8a5 5 0 0 1 10 0v3"/><circle cx="12" cy="16.5" r="1.5"/></svg>
              </span>
              <div>
                <h3>Private by design</h3>
                <p>Only participants can read a thread. Sessions are short-lived.</p>
              </div>
            </div>
            <div className="auth__feature">
              <span className="auth__feature-icon" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
              </span>
              <div>
                <h3>Works anywhere in India</h3>
                <p>Same global app — no phone numbers, no location permission.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="auth__aside-footer">
          <div>© {new Date().getFullYear()} Connectly. React · Socket.IO · MongoDB.</div>
          <div style={{ marginTop: 4, opacity: 0.8 }}>Your messages are stored so history is available on every device.</div>
        </div>
      </aside>

      <main className="auth__panel">
        <div className="auth-theme-toggle">
          <ThemeToggle />
        </div>
        <div className="auth__card">
          <div className="auth__mobile-brand">
            <Brand />
          </div>
          {children}
          {footer ? <div className="auth__footer">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

export default AuthLayout;
