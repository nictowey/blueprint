import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';

export default function App() {
  return (
    <div className="min-h-screen bg-dark-bg">
      <Header />
      <Routes>
        <Route path="/"           element={<TemplatePicker />} />
        <Route path="/matches"    element={<MatchResults />} />
        <Route path="/comparison" element={<ComparisonDetail />} />
      </Routes>
    </div>
  );
}
