import { Save, ShieldCheck, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button, Card, Field, InlineAlert, PageHeader, useToast } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { api, errorMessage, unwrap } from '../lib/api';
import { initials, titleCase } from '../lib/format';
import type { User } from '../types';

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await api.patch<User | { data: User }>('/users/me', {
        name: form.get('name'),
        phone: form.get('phone'),
        department: form.get('department'),
      });
      updateUser(unwrap(response));
      notify({ title: 'Profile updated', description: 'Your contact details were saved.', tone: 'success' });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack narrow-page">
      <PageHeader description="Keep your identity and transport contact details current." eyebrow="Account" title="Profile & settings" />
      <Card className="profile-card">
        <div className="profile-card__identity">
          <div className="avatar avatar--large">{initials(user.name)}</div>
          <div><h2>{user.name}</h2><p>{user.email}</p><span>{titleCase(user.role)}</span></div>
        </div>
        {error && <InlineAlert>{error}</InlineAlert>}
        <form className="profile-form" onSubmit={saveProfile}>
          <Field defaultValue={user.name} icon={<UserRound aria-hidden="true" size={18} />} label="Full name" name="name" required />
          <Field defaultValue={user.email} disabled label="Email" name="email" type="email" />
          {user.studentId && <Field defaultValue={user.studentId} disabled label="Student ID" name="studentId" />}
          <Field defaultValue={user.phone} label="Phone" name="phone" type="tel" />
          {user.role === 'STUDENT' && <Field defaultValue={user.department} label="Department" name="department" />}
          <div className="form-actions"><Button icon={<Save aria-hidden="true" size={17} />} loading={saving} type="submit">Save changes</Button></div>
        </form>
      </Card>
      <Card className="security-card">
        <ShieldCheck aria-hidden="true" />
        <div><h3>Account security</h3><p>Password and session management are handled through encrypted server endpoints. Signing out invalidates your active refresh session.</p></div>
      </Card>
    </div>
  );
}
