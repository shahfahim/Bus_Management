import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { Button, Field, InlineAlert } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../lib/api';
import { localDateInputValue } from '../lib/format';

interface LocationState {
  from?: { pathname?: string };
}

export function AuthPage({ initialMode = 'login' }: { initialMode?: 'login' | 'register' }) {
  const [mode, setMode] = useState(initialMode);
  const [registrationRole, setRegistrationRole] = useState<'STUDENT' | 'DRIVER'>('STUDENT');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setMode(initialMode), [initialMode]);
  if (!loading && user) return <Navigate replace to="/dashboard" />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'login') {
        await login({ email: String(form.get('email')), password: String(form.get('password')) });
      } else {
        const password = String(form.get('password'));
        if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
          throw new Error('Use at least 10 characters, including lowercase, uppercase and a number.');
        }
        const common = {
          name: String(form.get('name')),
          email: String(form.get('email')),
          password,
          phone: String(form.get('phone') || '') || undefined,
        };
        const registration = await register(
          registrationRole === 'STUDENT'
            ? {
                ...common,
                role: 'STUDENT',
                studentId: String(form.get('studentId')),
                department: String(form.get('department')),
              }
            : {
                ...common,
                role: 'DRIVER',
                employeeNumber: String(form.get('employeeNumber')),
                licenseNumber: String(form.get('licenseNumber')),
                licenseExpiresAt: String(form.get('licenseExpiresAt')),
              },
        );
        if (registration.approvalRequired) {
          setMode('login');
          setNotice('Account submitted. A transport administrator must verify and activate it before you can sign in.');
          return;
        }
      }
      const state = location.state as LocationState | null;
      navigate(state?.from?.pathname ?? '/dashboard', { replace: true });
    } catch (reason) {
      setError(
        errorMessage(
          reason,
          mode === 'login' ? 'We could not sign you in.' : 'We could not create your account.',
        ),
      );
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
            <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Account registration'}</p>
            <h1>{mode === 'login' ? 'Your campus, on schedule.' : 'Start riding smarter.'}</h1>
            <p>{mode === 'login' ? 'Sign in to manage trips, seats and live bus updates.' : 'Register with any valid email. A transport administrator will review your account.'}</p>
          </div>
          <div aria-label="Authentication mode" className="segmented-control" role="tablist">
            <button aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); setNotice(''); }} role="tab" type="button">Sign in</button>
            <button aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(''); setNotice(''); }} role="tab" type="button">Register</button>
          </div>
          {error && <InlineAlert>{error}</InlineAlert>}
          {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <>
                <fieldset className="role-picker">
                  <legend>Register as</legend>
                  <div aria-label="Account role" className="segmented-control segmented-control--roles" role="radiogroup">
                    {(['STUDENT', 'DRIVER'] as const).map((role) => (
                      <button
                        aria-checked={registrationRole === role}
                        aria-selected={registrationRole === role}
                        key={role}
                        onClick={() => { setRegistrationRole(role); setError(''); }}
                        role="radio"
                        type="button"
                      >
                        {role[0]}{role.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <Field autoComplete="name" icon={<UserRound aria-hidden="true" size={18} />} label="Full name" name="name" placeholder="Your full name" required />
              </>
            )}
            <Field autoComplete="email" icon={<Mail aria-hidden="true" size={18} />} label="Email address" name="email" placeholder="name@example.com" required type="email" />
            {mode === 'register' && (
              <>
                {registrationRole === 'STUDENT' && (
                  <div className="form-grid">
                    <Field autoComplete="off" label="Student ID" name="studentId" placeholder="e.g. 2026-00123" required />
                    <Field label="Department" name="department" placeholder="Computer Science" required />
                  </div>
                )}
                {registrationRole === 'DRIVER' && (
                  <>
                    <div className="form-grid">
                      <Field autoComplete="off" label="Employee ID" name="employeeNumber" placeholder="e.g. DRV-104" required />
                      <Field autoComplete="off" label="License number" name="licenseNumber" placeholder="Driver license number" required />
                    </div>
                    <Field label="License expiry date" min={localDateInputValue(new Date(Date.now() + 86_400_000))} name="licenseExpiresAt" required type="date" />
                  </>
                )}
                <Field autoComplete="tel" label="Phone (optional)" name="phone" placeholder="+880 …" type="tel" />
              </>
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
              {mode === 'login' ? 'Sign in securely' : `Create ${registrationRole.toLowerCase()} account`}
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
