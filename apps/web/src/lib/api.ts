export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') headers.set('X-GitOrbit', '1');
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiClientError(
      body?.error?.message || 'Unable to connect to GitOrbit. Please try again.',
      body?.error?.code || 'NETWORK_ERROR',
      response.status,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function dateLabel(value: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
}
