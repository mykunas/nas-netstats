const backendUrl = `${window.location.protocol}//${window.location.hostname}:8000`;

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
