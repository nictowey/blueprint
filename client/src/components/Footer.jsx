import { Link, useNavigate } from 'react-router-dom';

function BlueprintMark({ size = 24 }) {
  return (
    <div
      className="rounded-lg flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #c9a84c 0%, #a88b3d 100%)',
      }}
    >
      <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.9"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.5"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.5"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.25"/>
      </svg>
    </div>
  );
}

function FooterCol({ title, items }) {
  const navigate = useNavigate();
  return (
    <div>
      <div className="label-xs mb-2.5">{title}</div>
      <div className="flex flex-col gap-2">
        {items.map(([label, path]) => {
          if (!path || path === '#') {
            return (
              <span key={label} className="text-[13px] text-text-muted cursor-default">
                {label}
              </span>
            );
          }
          const internal = path.startsWith('/');
          if (internal) {
            return (
              <button
                key={label}
                onClick={() => {
                  if (path.startsWith('/?')) {
                    const [base, query] = path.split('?');
                    navigate({ pathname: base || '/', search: `?${query}` });
                  } else {
                    navigate(path);
                  }
                }}
                className="text-[13px] text-text-secondary hover:text-text-primary transition-colors text-left"
              >
                {label}
              </button>
            );
          }
          return (
            <a
              key={label}
              href={path}
              className="text-[13px] text-text-secondary hover:text-text-primary transition-colors"
            >
              {label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="mt-auto safe-bottom" style={{ paddingTop: 48, paddingBottom: 28, borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          className="footer-grid grid gap-8 sm:gap-10 mb-8"
          style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)' }}
        >
          <div className="footer-brand">
            <Link to="/" className="flex items-center gap-2.5 mb-3 hover:opacity-90 transition-opacity">
              <BlueprintMark size={24} />
              <span className="font-display text-lg">Blueprint</span>
            </Link>
            <p className="text-text-secondary text-[13px] max-w-sm leading-relaxed m-0">
              Find stocks that look like NVDA before it 10x&rsquo;d. Pattern matching across fundamentals and technicals, not vibes.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <span className="live-dot" />
              <span className="label-xs">Market open · data from FMP</span>
            </div>
          </div>

          <FooterCol
            title="Product"
            items={[
              ['Screener', '/'],
              ['Watchlist', '/watchlist'],
            ]}
          />
          <FooterCol
            title="Trust"
            items={[
              ['Methodology', '/proof'],
              ['Proof', '/proof'],
              ['Data provenance', '/proof'],
            ]}
          />
          <FooterCol
            title="Company"
            items={[
              ['Contact', 'mailto:nictowey@gmail.com'],
              ['Terms', '#'],
              ['Privacy', '#'],
            ]}
          />
        </div>

        <div className="h-px w-full bg-border mb-4" />

        <div className="flex flex-wrap gap-3 items-center text-[11px] text-text-muted">
          <span>© {new Date().getFullYear()} Blueprint Analytics</span>
          <span>·</span>
          <span>Data via Financial Modeling Prep</span>
          <span>·</span>
          <span>Quotes delayed 15m unless marked live</span>
          <span className="sm:ml-auto">Not investment advice. Past performance does not guarantee future results.</span>
        </div>
      </div>
    </footer>
  );
}
