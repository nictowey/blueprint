import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-dark-bg flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-5">
              <span className="text-red-400 text-2xl font-display">!</span>
            </div>
            <h1 className="text-xl font-display text-warm-white mb-2">Something went wrong</h1>
            <p className="text-sm text-warm-gray mb-6 font-light">
              An unexpected error occurred. This has been logged automatically.
            </p>
            <button
              className="btn-primary"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            >
              Back to Home
            </button>
            {this.state.error && (
              <details className="mt-6 text-left">
                <summary className="text-xs text-warm-muted cursor-pointer hover:text-warm-gray transition-colors">
                  Technical details
                </summary>
                <pre className="mt-2 text-xs text-warm-muted bg-dark-card rounded-lg p-3 overflow-auto max-h-40 border border-dark-border font-mono">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
