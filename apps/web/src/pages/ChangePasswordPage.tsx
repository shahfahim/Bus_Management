import { KeyRound, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, InlineAlert, PageHeader, useToast } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api, errorMessage, unwrap } from '../lib/api';
import type { User } from '../types';

export function ChangePasswordPage() {
  const { user, updateUser } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!user) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');
    if (newPassword !== confirmation) {
      setError('The new password and confirmation do not match.');
      return;
    }
    setSaving(true);
    try {
      const updated = unwrap(
        await api.post<User | { data: User }>('/auth/change-password', { currentPassword, newPassword }),
      );
      updateUser(updated);
      notify({ title: 'Password changed', description: 'Other signed-in sessions were revoked.', tone: 'success' });
      navigate('/dashboard', { replace: true });
    } catch (reason) {
      setError(errorMessage(reason, 'The password could not be changed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack narrow-page">
      <PageHeader
        description={user.mustChangePassword
          ? 'Replace the temporary password before using your transport account.'
          : 'Choose a new password and revoke your other active sessions.'}
        eyebrow="Account security"
        title={user.mustChangePassword ? 'Secure your account' : 'Change password'}
      />
      {user.mustChangePassword && (
        <InlineAlert tone="warning">
          Your administrator-issued password is temporary. No other account features are available until it is changed.
        </InlineAlert>
      )}
      <Card className="profile-card">
        <form className="profile-form" onSubmit={submit}>
          {error && <InlineAlert>{error}</InlineAlert>}
          <Field
            autoComplete="current-password"
            icon={<KeyRound aria-hidden="true" size={18} />}
            label="Current password"
            name="currentPassword"
            required
            type="password"
          />
          <Field
            autoComplete="new-password"
            hint="Use 10–128 characters with uppercase, lowercase, and a number."
            icon={<ShieldCheck aria-hidden="true" size={18} />}
            label="New password"
            minLength={10}
            name="newPassword"
            required
            type="password"
          />
          <Field
            autoComplete="new-password"
            label="Confirm new password"
            minLength={10}
            name="confirmation"
            required
            type="password"
          />
          <div className="form-actions">
            <Button loading={saving} type="submit">Save new password</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
