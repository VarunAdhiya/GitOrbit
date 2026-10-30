import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../apps/web/src/lib/api.ts';

afterEach(() => vi.unstubAllGlobals());
describe('browser API recovery', () => {
  it.each(['network', 'gateway'])('recovers a GET after a temporary %s failure', async (kind) => {
    const fetcher = vi.fn();
    if (kind === 'network') fetcher.mockRejectedValueOnce(new TypeError('fetch failed'));
    else fetcher.mockResolvedValueOnce(new Response('', { status: 502 }));
    fetcher.mockResolvedValueOnce(Response.json({ total: 3 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await api('/opportunities')).toEqual({ total: 3 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['POST', 'PATCH', 'DELETE'])('never replays a %s mutation', async (method) => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('connection interrupted'));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/profiles', { method })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 429])('does not retry HTTP %i', async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: { code: 'EXPECTED', message: 'Expected failure' } }, { status }),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/recommendations')).rejects.toMatchObject({ status, code: 'EXPECTED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('stops retrying after the second temporary failure', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 }),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/opportunities')).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cancels pending retries when navigating away', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(async () => {
      setTimeout(() => controller.abort(), 20);
      throw new TypeError('connection interrupted');
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/config', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
