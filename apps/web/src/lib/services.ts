import type { ServiceStatus } from '@cs5224/types';

async function probe(url: string): Promise<'up' | 'down'> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export async function fetchServiceStatuses(): Promise<ServiceStatus[]> {
  const pyUrl = process.env.NEXT_PUBLIC_PY_API_URL ?? 'http://localhost:8000';
  const goUrl = process.env.NEXT_PUBLIC_GO_API_URL ?? 'http://localhost:8080';

  const [pyStatus, goStatus] = await Promise.all([
    probe(`${pyUrl}/health`),
    probe(`${goUrl}/health`)
  ]);

  return [
    { name: 'FastAPI', url: pyUrl, status: pyStatus },
    { name: 'Go API', url: goUrl, status: goStatus }
  ];
}
