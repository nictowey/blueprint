import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getWatchlist } from '../utils/watchlist';
import { useTheme } from '../utils/theme';

export default function Header() {
  const watchlistCount = getWatchlist().length;
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef(null);
  const location = useLocation();

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

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
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [menuOpen]);

  return (
    <header
      ref={menuRef}
      className={`sticky top-0 z-20 transition-all duration-500 border-b ${
        scrolled
          ? 'bg-bg/90 backdrop-blur-xl shadow-lg border-border'
          : 'bg-transparent border-transparent'
      }`}
    >
      <div className={`max-w-6xl mx-auto px-4 sm:px-6 flex items-center transition-all duration-500 ${
        scrolled ? 'py-2.5' : 'py-4 sm:py-5'
      }`}>
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-all group min-h-[44px]">
          <div className={`rounded-xl flex items-center justify-center transition-all duration-500 ${
            scrolled ? 'w-8 h-8' : 'w-9 h-9'
          }`} style={{
            background: 'linear-gradient(135deg, #c9a84c 0%, #a88b3d 100%)',
            boxShadow: '0 2px 12px -2px rgba(201, 168, 76, 0.3)',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.9"/>
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.5"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.5"/>
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#06060a" opacity="0.25"/>
            </svg>
          </div>
          <span className={`font-display text-text-primary tracking-tight transition-all duration-500 ${
            scrolled ? 'text-lg' : 'text-xl'
          }`}>Blueprint</span>
        </Link>

        {/* Tagline */}
        <span className="text-text-muted text-sm hidden lg:block ml-3 font-light italic">
          pattern matching for breakout stocks
        </span>

        {/* Desktop nav */}
        <div className="ml-auto hidden md:flex items-center gap-1">
          <Link
            to="/proof"
            className="text-[13px] text-text-muted hover:text-text-primary transition-all duration-200 px-4 py-2 rounded-lg hover:bg-surface-hover min-h-[44px] flex items-center"
          >
            Methodology
          </Link>
          <Link
            to="/watchlist"
            className="flex items-center gap-2 text-[13px] text-text-muted hover:text-text-primary transition-all duration-200 px-4 py-2 rounded-lg hover:bg-surface-hover min-h-[44px]"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
            Watchlist
            {watchlistCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold bg-brand/15 text-brand-light">
                {watchlistCount}
              </span>
            )}
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-hover"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            )}
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          className="ml-auto md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-surface-hover"
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {menuOpen ? (
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            ) : (
              <path d="M3 6h14M3 10h10M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          menuOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-5 pt-2 bg-surface/98 backdrop-blur-2xl border-t border-border">
          <Link
            to="/proof"
            className="flex items-center text-[15px] text-text-secondary hover:text-text-primary transition-colors duration-200 py-3.5 px-3 rounded-lg hover:bg-surface-hover"
          >
            Methodology
          </Link>
          <Link
            to="/watchlist"
            className="flex items-center gap-2.5 text-[15px] text-text-secondary hover:text-text-primary transition-colors duration-200 py-3.5 px-3 rounded-lg hover:bg-surface-hover"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
            Watchlist
            {watchlistCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold bg-brand/15 text-brand-light">
                {watchlistCount}
              </span>
            )}
          </Link>

          {/* Mobile theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2.5 w-full text-[15px] text-text-secondary hover:text-text-primary transition-colors duration-200 py-3.5 px-3 rounded-lg hover:bg-surface-hover"
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            )}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </div>
    </header>
  );
}
