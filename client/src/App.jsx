import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import ErrorBoundary from './components/ErrorBoundary';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-dark-bg flex flex-col">
        <Header />
        <Routes>
          <Route path="/"           element={<TemplatePicker />} />
          <Route path="/matches"    element={<MatchResults />} />
          <Route path="/comparison" element={<ComparisonDetail />} />
          <Route path="*"           element={<NotFound />} />
        </Routes>
        <footer className="border-t border-dark-border py-4 sm:py-6 mt-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
            <span>Blueprint — Stock breakout pattern matching</span>
            <span>Data via Financial Modeling Prep</span>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
