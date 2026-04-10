import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';

export default function App() {
  return (
    <div className="min-h-screen bg-dark-bg flex flex-col">
      <Header />
      <div className="flex-1">
        <Routes>
          <Route path="/"           element={<TemplatePicker />} />
          <Route path="/matches"    element={<MatchResults />} />
          <Route path="/comparison" element={<ComparisonDetail />} />
        </Routes>
      </div>
      <footer className="border-t border-dark-border py-6 mt-12">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
          <span>Blueprint — Stock breakout pattern matching</span>
          <span>Data via Financial Modeling Prep</span>
        </div>
      </footer>
    </div>
  );
}
