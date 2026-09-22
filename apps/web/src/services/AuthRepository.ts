import { api, unwrap } from '../lib/api';

export class AuthRepository {
  async getSession() {
    const response = await api.get('/auth/me');
    return unwrap(response);
  }

  async login(credentials: Record<string, unknown>) {
    const response = await api.post('/auth/login', credentials);
    return unwrap(response);
  }

  async logout() {
    await api.post('/auth/logout');
  }

  async register(data: Record<string, unknown>) {
    const response = await api.post('/auth/register', data);
    return unwrap(response);
  }
}

export const authRepository = new AuthRepository();
