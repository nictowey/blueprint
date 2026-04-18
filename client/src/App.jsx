import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './utils/theme';
import Header from './components/Header';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';
import StockDetail from './pages/StockDetail';
import BacktestResults from './pages/BacktestResults';
import WatchlistPage from './pages/Watchlist';
import Proof from './pages/Proof';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <div className="min-h-screen flex flex-col bg-bg text-text-primary">
          <ScrollToTop />
          <Header />
          <Routes>
            <Route path="/"           element={<TemplatePicker />} />
            <Route path="/matches"    element={<MatchResults />} />
            <Route path="/comparison" element={<ComparisonDetail />} />
            <Route path="/stock/:ticker" element={<StockDetail />} />
            <Route path="/backtest"   element={<BacktestResults />} />
            <Route path="/proof"      element={<Proof />} />
            <Route path="/watchlist"  element={<WatchlistPage />} />
            <Route path="*"           element={<NotFound />} />
          </Routes>
          <Footer />
        </div>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
