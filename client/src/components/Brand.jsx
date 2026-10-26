export const BRAND_NAME = 'Connectly';
export const BRAND_TAGLINE = 'Private conversations, anywhere in India.';

export function Brand({ size = 'md', withTagline = false, className = '' }) {
  return (
    <span className={['brand', size === 'sm' ? 'brand--sm' : '', className].filter(Boolean).join(' ')}>
      <span className="brand__mark" aria-hidden>
        <svg width={size === 'sm' ? 14 : 16} height={size === 'sm' ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10h8" />
          <path d="M8 14h5" />
          <path d="M7 19c-1.2 0-2-.9-2-2V7c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2h-2l-3 3-1.1-1.8" />
        </svg>
      </span>
      <span>{BRAND_NAME}</span>
      {withTagline ? <span className="sr-only"> — {BRAND_TAGLINE}</span> : null}
    </span>
  );
}

export default Brand;
