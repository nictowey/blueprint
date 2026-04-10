import { Link } from 'react-router-dom';
import { getWatchlist } from '../utils/watchlist';

export default function Header() {
  const watchlistCount = getWatchlist().length;

  return (
    <header className="border-b border-dark-border bg-dark-card/50 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-2 sm:gap-3">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" opacity="0.3"/>
            </svg>
          </div>
          <span className="text-xl font-bold text-slate-100 tracking-tight">Blueprint</span>
        </Link>
        <span className="text-slate-500 text-sm hidden sm:block">
          Find tomorrow's breakouts by matching yesterday's winners
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link
            to="/watchlist"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
            <span className="hidden sm:inline">Watchlist</span>
            {watchlistCount > 0 && (
              <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-medium">
                {watchlistCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
