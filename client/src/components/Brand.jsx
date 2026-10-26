import { MessagesSquare } from 'lucide-react';

export const BRAND_NAME = 'Connectly';
export const BRAND_TAGLINE = 'Private conversations, anywhere in India.';

export function Brand({ size = 'md', withTagline = false, className = '' }) {
  return (
    <span className={['brand', size === 'sm' ? 'brand--sm' : '', className].filter(Boolean).join(' ')}>
      <span className="brand__mark" aria-hidden>
        <MessagesSquare size={size === 'sm' ? 16 : 19} strokeWidth={2.2} />
      </span>
      <span>
        {BRAND_NAME}
        {withTagline ? (
          <span className="sr-only"> — {BRAND_TAGLINE}</span>
        ) : null}
      </span>
    </span>
  );
}

export default Brand;
