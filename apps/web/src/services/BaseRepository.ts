import { api, withQuery, unwrap } from '../lib/api';
import type { QueryValue } from '../lib/api';

export abstract class BaseRepository<T> {
  protected constructor(protected readonly basePath: string) {}

  protected get endpoint() {
    return this.basePath;
  }

  async getAll(query?: Record<string, QueryValue>): Promise<T[]> {
    const url = query ? withQuery(this.endpoint, query) : this.endpoint;
    const response = await api.get<unknown>(url);
    // Support paginated responses that return items in an 'items' array
    const value = unwrap(response);
    if (value && typeof value === 'object' && 'items' in value) {
      return (value as { items: T[] }).items;
    }
    return (Array.isArray(value) ? value : []) as T[];
  }

  async getById(id: string): Promise<T> {
    const response = await api.get<unknown>(`${this.endpoint}/${id}`);
    return unwrap(response) as T;
  }

  async create<D = Partial<T>>(data: D): Promise<T> {
    const response = await api.post<unknown>(this.endpoint, data);
    return unwrap(response) as T;
  }

  async update<D = Partial<T>>(id: string, data: D): Promise<T> {
    const response = await api.patch<unknown>(`${this.endpoint}/${id}`, data);
    return unwrap(response) as T;
  }

  async delete(id: string): Promise<void> {
    await api.delete(`${this.endpoint}/${id}`);
  }
}
