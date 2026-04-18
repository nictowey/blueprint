import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getWatchlist } from '../utils/watchlist';
import { useTheme } from '../utils/theme';

const NAV_ITEMS = [
  { label: 'Screener', path: '/' },
  { label: 'Methodology', path: '/proof' },
];

function BlueprintMark({ size = 32 }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center transition-all duration-500"
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #c9a84c 0%, #a88b3d 100%)',
        boxShadow: '0 2px 12px -2px rgba(201, 168, 76, 0.3)',
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

function IconStar({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function IconSun({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  );
}

function IconMoon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  );
}

export default function Header() {
  const watchlistCount = getWatchlist().length;
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    const onClick = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Active state: Screener matches home AND match/comparison/stock (template flow)
  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/'
        || location.pathname.startsWith('/matches')
        || location.pathname.startsWith('/comparison')
        || location.pathname.startsWith('/stock');
    }
    if (path === '/?blend=1') {
      return location.pathname === '/' && location.search.includes('blend=1');
    }
    return location.pathname.startsWith(path);
  };

  function goNav(path) {
    setMenuOpen(false);
    if (path.startsWith('/?')) {
      const [base, query] = path.split('?');
      navigate({ pathname: base || '/', search: `?${query}` });
    } else {
      navigate(path);
    }
  }

  return (
    <>
      <header
        ref={menuRef}
        className={`sticky top-0 z-20 transition-all duration-500 border-b ${
          scrolled
            ? 'bg-bg/90 backdrop-blur-xl border-border'
            : 'bg-transparent border-transparent'
        }`}
      >
        <div
          className={`max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-4 transition-all duration-300 ${
            scrolled ? 'py-2.5' : 'py-3.5 sm:py-4'
          }`}
        >
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-all min-h-[44px]">
            <BlueprintMark size={scrolled ? 28 : 32} />
            <span className={`font-display text-text-primary transition-all duration-500 ${
              scrolled ? 'text-lg' : 'text-xl'
            }`}>
              Blueprint
            </span>
          </Link>

          {/* Tagline */}
          <span className="font-display text-text-muted text-[13px] italic hidden lg:inline-block whitespace-nowrap -ml-1">
            pattern matching for breakout stocks
          </span>

          {/* Desktop nav */}
          <nav className="ml-auto hidden md:flex items-center gap-0.5">
            {NAV_ITEMS.map(item => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => goNav(item.path)}
                  className={`relative text-[13px] px-3 py-2 rounded-lg transition-colors ${
                    active ? 'text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span
                      className="absolute left-3 right-3 bottom-1 h-px"
                      style={{ background: 'var(--color-brand-2)' }}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}

            <div className="w-px h-5 bg-border mx-2" />

            <Link
              to="/watchlist"
              className="relative min-h-[36px] min-w-[36px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors"
              title="Watchlist"
            >
              <IconStar size={16} />
              {watchlistCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 text-[9px] px-1 rounded-full font-mono font-bold"
                  style={{ background: 'rgba(201,168,76,0.2)', color: 'var(--color-brand-2)', minWidth: 14 }}
                >
                  {watchlistCount}
                </span>
              )}
            </Link>

            <button
              onClick={toggleTheme}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
          </nav>

          {/* Mobile right cluster */}
          <div className="ml-auto md:hidden flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
            <button
              className="min-h-[40px] min-w-[40px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-lg hover:bg-surface-2 transition-colors"
              onClick={() => setMenuOpen(v => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {menuOpen ? (
                  <><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></>
                ) : (
                  <><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile full-screen menu */}
        {menuOpen && (
          <div className="md:hidden fixed inset-0 z-30 bg-bg animate-fade-in flex flex-col px-5 pt-4 pb-6 safe-bottom">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <BlueprintMark size={28} />
                <span className="font-display text-lg">Blueprint</span>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-text-secondary hover:text-text-primary rounded-lg"
                aria-label="Close menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>
                </svg>
              </button>
            </div>

            {[...NAV_ITEMS, { label: 'Watchlist', path: '/watchlist' }].map(item => (
              <button
                key={item.path}
                onClick={() => goNav(item.path)}
                className="flex items-center justify-between py-4 text-left border-b border-border text-[16px] text-text-primary"
              >
                <span>{item.label}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ))}

            <div className="mt-auto pt-6 text-[11px] text-text-muted text-center">
              Data via FMP · Not investment advice
            </div>
          </div>
        )}
      </header>
    </>
  );
}
