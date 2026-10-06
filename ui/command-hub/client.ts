// Credentials stay in the server vault. The hub access token is memory-only.
let hubToken = '';
export function setHubToken(value: string) { hubToken = value; }
const headers = () => ({ 'Content-Type': 'application/json', ...(hubToken ? { Authorization: `Bearer ${hubToken}` } : {}) });
export async function api(route: string, body?: unknown) {
  const response = await fetch(`/api/hub/${route}`, { method: body ? 'POST' : 'GET', headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export async function run(body: unknown, onEvent: (event: any) => void, signal: AbortSignal) {
  const response = await fetch('/api/hub/run', { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error((await response.json()).error || 'Workflow failed');
  if (!response.body) throw new Error('Streaming is unavailable');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let ended = false;
  const consume = (line: string) => { if (!line.trim()) return; const event = JSON.parse(line); if (['done','error'].includes(event.type)) ended = true; onEvent(event); };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(consume);
    if (done) { consume(buffer); break; }
  }
  if (!ended) throw new Error('Connection ended before the workflow completed');
}
