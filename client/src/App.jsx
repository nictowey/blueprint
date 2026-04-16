import { Routes, Route, Link } from 'react-router-dom';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';
import BacktestResults from './pages/BacktestResults';
import WatchlistPage from './pages/Watchlist';
import Proof from './pages/Proof';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-dark-bg flex flex-col">
        <ScrollToTop />
        <Header />
        <Routes>
          <Route path="/"           element={<TemplatePicker />} />
          <Route path="/matches"    element={<MatchResults />} />
          <Route path="/comparison" element={<ComparisonDetail />} />
          <Route path="/backtest"   element={<BacktestResults />} />
          <Route path="/proof"      element={<Proof />} />
          <Route path="/watchlist"  element={<WatchlistPage />} />
          <Route path="*"           element={<NotFound />} />
        </Routes>
        <footer className="border-t border-dark-border py-6 sm:py-8 mt-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="divider-gold mb-6" />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-warm-muted">
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded bg-gradient-to-br from-accent/20 to-accent-dim/10 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#c9a84c" opacity="0.7"/>
                    <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#c9a84c" opacity="0.4"/>
                    <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#c9a84c" opacity="0.4"/>
                    <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#c9a84c" opacity="0.2"/>
                  </svg>
                </div>
                <span className="font-display text-sm text-warm-gray">Blueprint</span>
              </div>
              <div className="flex items-center gap-4 flex-wrap justify-center">
                <Link to="/proof" className="hover:text-warm-gray transition-colors">Methodology</Link>
                <span className="text-dark-border hidden sm:inline">·</span>
                <Link to="/watchlist" className="hover:text-warm-gray transition-colors">Watchlist</Link>
                <span className="text-dark-border hidden sm:inline">·</span>
                <span>Data via Financial Modeling Prep</span>
                <span className="text-dark-border hidden sm:inline">·</span>
                <span>Not financial advice</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
