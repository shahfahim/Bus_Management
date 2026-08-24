import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Button, Field, InlineAlert } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../lib/api';

interface LocationState {
  from?: { pathname?: string };
}

export function AuthPage({ initialMode = 'login' }: { initialMode?: 'login' | 'register' }) {
  const [mode, setMode] = useState(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setMode(initialMode), [initialMode]);
  if (!loading && user) return <Navigate replace to="/dashboard" />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'login') {
        await login({ email: String(form.get('email')), password: String(form.get('password')) });
      } else {
        const password = String(form.get('password'));
        if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
          throw new Error('Use at least 10 characters, including lowercase, uppercase and a number.');
        }
        await register({
          name: String(form.get('name')),
          email: String(form.get('email')),
          password,
          studentId: String(form.get('studentId')),
          department: String(form.get('department') || ''),
          phone: String(form.get('phone') || ''),
        });
      }
      const state = location.state as LocationState | null;
      navigate(state?.from?.pathname ?? '/dashboard', { replace: true });
    } catch (reason) {
      setError(errorMessage(reason, 'We could not sign you in.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <Brand />
        <div className="auth-card">
          <div className="auth-card__heading">
            <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Student registration'}</p>
            <h1>{mode === 'login' ? 'Your campus, on schedule.' : 'Start riding smarter.'}</h1>
            <p>{mode === 'login' ? 'Sign in to manage trips, seats and live bus updates.' : 'Create your verified student transport account.'}</p>
          </div>
          <div aria-label="Authentication mode" className="segmented-control" role="tablist">
            <button aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); }} role="tab" type="button">Sign in</button>
            <button aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); }} role="tab" type="button">Register</button>
          </div>
          {error && <InlineAlert>{error}</InlineAlert>}
          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <div className="form-grid">
                <Field autoComplete="name" icon={<UserRound aria-hidden="true" size={18} />} label="Full name" name="name" placeholder="Your full name" required />
                <Field autoComplete="off" label="Student ID" name="studentId" placeholder="e.g. 2026-00123" required />
              </div>
            )}
            <Field autoComplete="email" icon={<Mail aria-hidden="true" size={18} />} label="University email" name="email" placeholder="name@university.edu" required type="email" />
            {mode === 'register' && (
              <div className="form-grid">
                <Field label="Department" name="department" placeholder="Computer Science" required />
                <Field autoComplete="tel" label="Phone" name="phone" placeholder="+880 …" type="tel" />
              </div>
            )}
            <div className="password-field">
              <Field
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                hint={mode === 'register' ? '10+ characters with lowercase, uppercase and a number' : undefined}
                icon={<LockKeyhole aria-hidden="true" size={18} />}
                label="Password"
                minLength={mode === 'register' ? 10 : 1}
                name="password"
                required
                type={showPassword ? 'text' : 'password'}
              />
              <button aria-label={showPassword ? 'Hide password' : 'Show password'} className="password-toggle" onClick={() => setShowPassword((show) => !show)} type="button">
                {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
              </button>
            </div>
            <Button className="auth-submit" loading={submitting} size="lg" type="submit">
              {mode === 'login' ? 'Sign in securely' : 'Create student account'}
            </Button>
          </form>
          <p className="auth-security"><ShieldCheck aria-hidden="true" size={16} /> Protected by encrypted authentication and role-based access.</p>
        </div>
      </section>
      <aside className="auth-visual">
        <div className="auth-visual__glow" />
        <div className="route-illustration" aria-hidden="true">
          <div className="route-card route-card--eta"><span>Next arrival</span><strong>12 min</strong><small>Science Gate · Route A2</small></div>
          <div className="route-line"><i /><i /><i /><i /></div>
          <div className="route-bus">🚌</div>
          <div className="route-card route-card--seat"><span>Seat 08</span><strong>Confirmed</strong><small>QR pass ready</small></div>
        </div>
        <div className="auth-visual__copy">
          <span><Sparkles aria-hidden="true" size={16} /> One calm place for every ride</span>
          <h2>Know where your bus is.<br />Know your seat is waiting.</h2>
          <p>Live ETAs, secure entry and timely alerts connect the whole university transport network.</p>
        </div>
      </aside>
    </main>
  );
}
