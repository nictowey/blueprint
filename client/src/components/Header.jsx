import { Link } from 'react-router-dom';
import { getWatchlist } from '../utils/watchlist';

export default function Header() {
  const watchlistCount = getWatchlist().length;

  return (
    <header className="border-b border-dark-border bg-dark-bg/80 backdrop-blur-xl sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity group">
          {/* Logo mark — abstract grid pattern */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center shadow-lg shadow-accent/10">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#08080c" opacity="0.9"/>
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#08080c" opacity="0.5"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#08080c" opacity="0.5"/>
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#08080c" opacity="0.25"/>
            </svg>
          </div>
          <span className="text-xl font-display text-warm-white tracking-tight">Blueprint</span>
        </Link>
        <span className="text-warm-muted text-sm hidden sm:block ml-1 font-light">
          Stock breakout pattern matching
        </span>
        <div className="ml-auto flex items-center gap-4">
          <Link
            to="/proof"
            className="text-sm text-warm-gray hover:text-accent transition-colors duration-200"
          >
            Methodology
          </Link>
          <Link
            to="/watchlist"
            className="flex items-center gap-2 text-sm text-warm-gray hover:text-accent transition-colors duration-200"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="hidden sm:inline">Watchlist</span>
            {watchlistCount > 0 && (
              <span className="text-[10px] bg-accent/15 text-accent px-1.5 py-0.5 rounded-full font-mono font-semibold">
                {watchlistCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
