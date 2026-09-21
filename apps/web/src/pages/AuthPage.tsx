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
  const [notice, setNotice] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docPreview, setDocPreview] = useState('');
  const { user, loading, login } = useAuth();
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
        const formData = new FormData();
        const commonData = {
          name: String(form.get('name')),
          email: String(form.get('email')),
          password,
          phone: String(form.get('phone') || '') || undefined,
          role: 'STUDENT',
          studentId: String(form.get('studentId')),
          department: String(form.get('department')),
        };
        for (const [key, value] of Object.entries(commonData)) {
          if (value !== undefined) formData.append(key, value);
        }
        
        const documentFile = form.get('document');
        if (documentFile instanceof File && documentFile.size > 0) {
          formData.append('document', documentFile);
        }

        const response = await fetch('/api/auth/register', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || 'Registration failed');
        }
        
        const registration = await response.json();
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
          <div key={`${mode}-heading`} className="auth-mode-animated auth-card__heading">
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
          <form key={`${mode}-form`} className="auth-mode-animated auth-form" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <>
                <Field autoComplete="name" icon={<UserRound aria-hidden="true" size={18} />} label="Full name" name="name" placeholder="Your full name" required />
              </>
            )}
            <Field autoComplete="email" icon={<Mail aria-hidden="true" size={18} />} label="Email address" name="email" placeholder="name@example.com" required type="email" />
            {mode === 'register' && (
              <>
                  <div className="form-grid">
                    <Field autoComplete="off" label="Student ID" name="studentId" placeholder="e.g. 2024-100" required />
                    <Field label="Department" name="department" placeholder="Computer Science" required />
                  </div>
                <Field autoComplete="tel" label="Phone (optional)" name="phone" placeholder="+880 …" type="tel" />
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 750, color: '#3a4a47' }}>Verification Document <span style={{ color: '#c0392b' }}>*</span></label>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: '16px',
                      padding: '14px 16px',
                      border: '2px dashed #b0c8c3',
                      borderRadius: '14px',
                      background: '#f5f5f4',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s, background 0.2s',
                    }}
                    onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).style.borderColor = '#0f6657'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(15,102,87,0.04)'; }}
                    onDragLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#b0c8c3'; (e.currentTarget as HTMLDivElement).style.background = '#f5f5f4'; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      (e.currentTarget as HTMLDivElement).style.borderColor = '#b0c8c3';
                      (e.currentTarget as HTMLDivElement).style.background = '#f5f5f4';
                      const file = e.dataTransfer.files?.[0];
                      if (!file) return;
                      setDocFile(file);
                      setDocPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : '');
                    }}
                    onClick={() => document.getElementById('document')?.click()}
                  >
                    {/* Icon box */}
                    <div style={{
                      width: 56, height: 56, flexShrink: 0, borderRadius: '12px',
                      background: docFile ? 'linear-gradient(135deg,#0f6657,#1a8a72)' : 'linear-gradient(135deg,#e0eeeb,#c8dfd9)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', boxShadow: docFile ? '0 4px 14px rgba(15,102,87,0.22)' : 'none',
                      transition: 'all 0.25s',
                    }}>
                      {docPreview
                        ? <img src={docPreview} alt="doc" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : docFile
                          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8ab4ac" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="10" y1="15" x2="14" y2="15"/></svg>
                      }
                    </div>
                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.8rem', color: '#1a2e2a' }}>
                        {docFile ? docFile.name : 'ID card or Payment slip'}
                      </p>
                      <p style={{ margin: '0 0 9px', fontSize: '0.69rem', color: '#6b8480' }}>
                        {docFile ? `${(docFile.size / 1024).toFixed(0)} KB · click to replace` : 'Drag & drop here, or click to browse'}
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '4px 10px', borderRadius: '6px',
                          background: '#0f6657', color: 'white',
                          fontSize: '0.67rem', fontWeight: 750, cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(15,102,87,0.25)',
                        }} onClick={(e) => { e.stopPropagation(); document.getElementById('document')?.click(); }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          {docFile ? 'Replace file' : 'Choose file'}
                        </span>
                        {docFile && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            padding: '4px 10px', borderRadius: '6px',
                            border: '1px solid rgba(192,57,43,0.35)', color: '#c0392b',
                            fontSize: '0.67rem', fontWeight: 700, cursor: 'pointer',
                          }} onClick={(e) => { e.stopPropagation(); setDocFile(null); setDocPreview(''); }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                            Remove
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Format badges */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                      {['JPG', 'PNG', 'PDF'].map(f => (
                        <span key={f} style={{ fontSize: '0.57rem', fontWeight: 800, letterSpacing: '0.05em', padding: '2px 6px', borderRadius: '4px', background: '#e8edeb', color: '#6b8480' }}>{f}</span>
                      ))}
                    </div>
                  </div>
                  {/* Hidden real input — used by form submit handler */}
                  <input
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    id="document"
                    name="document"
                    required
                    style={{ display: 'none' }}
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setDocFile(file);
                      setDocPreview(file && file.type.startsWith('image/') ? URL.createObjectURL(file) : '');
                    }}
                  />
                  <small style={{ fontSize: '0.65rem', color: '#6b8480' }}>Max 5 MB. Must be clear and readable.</small>
                </div>
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
              {mode === 'login' ? 'SignIn' : `Create student account`}
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
