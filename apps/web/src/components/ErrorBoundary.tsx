import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Brand } from './Brand';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <Brand />
        <section className="fatal-error__card">
          <span className="fatal-error__icon"><AlertTriangle aria-hidden="true" /></span>
          <h1>We could not open this screen</h1>
          <p>Your account data is safe. Reload the application to reconnect and try again.</p>
          <button className="button button--primary button--md" onClick={() => window.location.reload()} type="button">
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
