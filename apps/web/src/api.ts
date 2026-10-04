import type { ApiError as ApiErrorBody, Me } from '@meta31/contracts';
import { accessToken } from './auth';

/** Failed API call, with the error body the Worker returns (stable codes, see contracts). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(`API ${status}${body ? ` ${body.error}` : ''}`);
  }
}

/** Calls the Worker with the session JWT (or the local dev token, see auth.ts). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, errorBody);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const getMe = () => api<Me>('GET', '/api/me');
