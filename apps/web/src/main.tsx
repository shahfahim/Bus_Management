import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import App from './App';
import { ToastProvider } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <SocketProvider>
              <App />
            </SocketProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
