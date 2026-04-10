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
              <span className="text-red-400 text-2xl">!</span>
            </div>
            <h1 className="text-xl font-semibold text-slate-100 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-400 mb-6">
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
                <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-400">
                  Technical details
                </summary>
                <pre className="mt-2 text-xs text-slate-600 bg-dark-card rounded-lg p-3 overflow-auto max-h-40 border border-dark-border">
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
