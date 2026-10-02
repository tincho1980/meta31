import { supabase } from './supabase';

export type Me = { id: string; name: string; email: string };

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`);
  }
}

/** Llama al Worker con el JWT de la sesión de Supabase. */
async function apiGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export const getMe = () => apiGet<Me>('/api/me');
