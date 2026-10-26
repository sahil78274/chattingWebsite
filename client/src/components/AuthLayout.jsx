import { Lock, ShieldCheck, Zap } from 'lucide-react';
import { Brand } from './Brand.jsx';

/**
 * Split layout used by every authentication screen: brand story on the left,
 * form on the right. Collapses to a single column on mobile.
 */
export function AuthLayout({ children, footer }) {
  return (
    <div className="auth">
      <aside className="auth__aside">
        <div className="auth__aside-content">
          <Brand />
          <h1>Private conversations with people across India.</h1>
          <p>
            Find anyone by their username and talk in real time. No phone numbers, no noise — just a
            clean, fast place to chat.
          </p>

          <div className="auth__preview" aria-hidden>
            <div className="auth__preview-bubble">
              Hey! Are you free to review the new dashboard?
              <div className="auth__preview-meta">Priya · 9:41 AM</div>
            </div>
            <div className="auth__preview-bubble auth__preview-bubble--out">
              Yes, sending notes in a minute.
              <div className="auth__preview-meta">Delivered · 9:42 AM</div>
            </div>
          </div>

          <ul className="auth__points">
            <li>
              <Zap size={17} aria-hidden />
              <span>Real-time delivery the moment you hit send.</span>
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden />
              <span>Session-based auth with rotating refresh tokens.</span>
            </li>
            <li>
              <Lock size={17} aria-hidden />
              <span>Private threads — only the two participants can read them.</span>
            </li>
          </ul>
        </div>
        <div className="auth__aside-footer">
          © {new Date().getFullYear()} Connectly. Built with React, Socket.IO and MongoDB.
        </div>
      </aside>

      <main className="auth__panel">
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
