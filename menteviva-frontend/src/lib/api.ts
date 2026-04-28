/**
 * Wrapper de fetch que adjunta el ID token de Firebase si hay sesión.
 *
 * Uso:
 *   const profile = await apiFetch("/api/auth/sync", { method: "POST" });
 *
 * Si no hay sesión Firebase, no manda Authorization. El backend rechaza con
 * 401 los endpoints protegidos; los públicos siguen funcionando.
 */

import { firebaseAuth } from "./firebase";

const API_URL = import.meta.env.VITE_API_URL || "";

export interface ApiFetchOptions extends RequestInit {
  json?: unknown;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {}
): Promise<T> {
  const headers = new Headers(opts.headers);

  if (firebaseAuth?.currentUser) {
    const token = await firebaseAuth.currentUser.getIdToken();
    headers.set("Authorization", `Bearer ${token}`);
  }

  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  }

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers, body });

  const text = await res.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // mantener como string
    }
  }

  if (!res.ok) {
    const detail =
      typeof parsed === "object" && parsed && "detail" in parsed
        ? String((parsed as Record<string, unknown>).detail)
        : undefined;
    throw new ApiError(res.status, parsed, detail);
  }

  return parsed as T;
}
