const backendUrl = `${window.location.protocol}//${window.location.hostname}:8000`;
const requestTimeoutMs = 8000;

export async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${backendUrl}${path}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
