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
  const request = {
    ...options,
    headers,
    credentials: 'same-origin' as const,
    cache: 'no-store' as const,
  };
  // Only reads are safe to replay automatically; uploads and profile writes are not.
  const canRetry = (options.method || 'GET').toUpperCase() === 'GET';
  let response!: Response;
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted();
    try {
      response = await fetch(`/api/v1${path}`, request);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (!canRetry || attempt === 1)
        throw new ApiClientError(
          'Unable to connect to GitOrbit. Please try again.',
          'NETWORK_ERROR',
          0,
        );
      await retryDelay(options.signal);
      continue;
    }
    if (canRetry && attempt === 0 && [502, 503, 504].includes(response.status)) {
      await response.body?.cancel();
      await retryDelay(options.signal);
      continue;
    }
    break;
  }
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
function retryDelay(signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 400);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
export function dateLabel(value: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
}
