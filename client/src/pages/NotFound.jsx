import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 flex-1 flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <p className="text-6xl font-display text-warm-muted/30 mb-2 italic">404</p>
        <h1 className="text-xl font-display text-warm-white mb-2">Page not found</h1>
        <p className="text-sm text-warm-gray mb-6 font-light">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    </main>
  );
}
