import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';

export function NotFoundPage() {
  return (
    <div className="empty-state" style={{ minHeight: '100dvh' }}>
      <div className="empty-state__inner">
        <Brand />
        <span className="empty-state__icon" style={{ marginTop: 18 }}>
          <Compass size={30} />
        </span>
        <h3>Page not found</h3>
        <p>The page you were looking for does not exist or has moved.</p>
        <Link to="/app" className="btn btn--primary btn--sm">
          Go to your conversations
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
