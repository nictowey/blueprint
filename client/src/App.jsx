import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';
import BacktestResults from './pages/BacktestResults';
import WatchlistPage from './pages/Watchlist';
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
          <Route path="/watchlist"  element={<WatchlistPage />} />
          <Route path="*"           element={<NotFound />} />
        </Routes>
        <footer className="border-t border-dark-border py-6 sm:py-8 mt-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="5" height="5" rx="1" fill="#6c63ff" opacity="0.9"/>
                    <rect x="8" y="1" width="5" height="5" rx="1" fill="#6c63ff" opacity="0.6"/>
                    <rect x="1" y="8" width="5" height="5" rx="1" fill="#6c63ff" opacity="0.6"/>
                    <rect x="8" y="8" width="5" height="5" rx="1" fill="#6c63ff" opacity="0.3"/>
                  </svg>
                </div>
                <span>Blueprint — Stock breakout pattern matching</span>
              </div>
              <div className="flex items-center gap-4">
                <span>Data via Financial Modeling Prep</span>
                <span className="text-slate-700">·</span>
                <span>Not financial advice</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
