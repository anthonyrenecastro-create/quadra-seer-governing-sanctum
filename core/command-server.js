import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { CredentialStore } from './agent-bus/store.js';
import { AgentBus, MODES } from './agent-bus/bus.js';
import { catalog } from '../agents/index.js';
dotenv.config({ path: '.env.local' }); dotenv.config();
export function createCommandApp(store = new CredentialStore(process.env.QUADRA_DATA_DIR || path.resolve('.quadra-local'))) {
  const app = express(); const bus = new AgentBus(store);
  const token = process.env.QUADRA_HUB_TOKEN;
  const origins = (process.env.QUADRA_HUB_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',');
  app.use('/api/hub', (req, res, next) => {
    const origin = req.headers.origin;
    if (!token && !['127.0.0.1','localhost','[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) return res.status(403).json({ error: 'Untrusted host' });
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: 'Origin is not permitted' });
    if (!token && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(403).json({ error: 'Local access only' });
    if (token) {
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Hub token required' });
    }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/hub/agents', (_req, res) => res.json({ agents: bus.list(), modes: MODES }));
  app.post('/api/hub/connect', async (req, res) => {
    try {
      const { id, model, endpoint, key, vision, webSearch, name } = req.body;
      let base = bus.registry().find(a => a.id === id);
      const isNew = !base;
      if (isNew && typeof id === 'string' && /^custom-[a-zA-Z0-9-]{1,60}$/.test(id) && typeof name === 'string' && name.trim() && name.length <= 80) base = { ...catalog.find(a => a.id === 'custom'), id, name: name.trim() };
      if (!base || typeof model !== 'string' || !model.trim() || model.length > 200) throw new Error('A known agent and model ID are required');
      const url = new URL(endpoint || base.endpoint);
      if (url.username || url.password || url.search || url.hash) throw new Error('Endpoint must not include credentials, query, or fragment');
      const normalized = url.href.replace(/\/$/, '');
      const allowed = [...catalog.map(a => a.endpoint).filter(Boolean), ...(process.env.QUADRA_AGENT_ENDPOINTS || '').split(',').filter(Boolean)];
      if (!allowed.includes(normalized)) throw new Error('Endpoint must be explicitly allowed in QUADRA_AGENT_ENDPOINTS on the local server');
      if (id === 'ollama' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('The orchestrator must use a local Ollama endpoint');
      if (id !== 'ollama' && (typeof key !== 'string' || !key.trim())) throw new Error('An API credential is required');
      const config = { endpoint: normalized, model: model.trim(), webSearch: !!base.supportsWebSearch && webSearch === true, capabilities: [...base.capabilities, ...(vision === true ? ['vision'] : []), ...(base.supportsWebSearch && webSearch === true ? ['research','current-information'] : [])] };
      if (isNew) store.set('_registry', [...(store.get('_registry') || []), base]);
      store.set(id, { config, key: id === 'ollama' ? undefined : key });
      res.json({ ok: true, status: 'configured' });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/hub/disconnect', (req, res) => {
    if (!bus.registry().some(a => a.id === req.body.id)) return res.status(400).json({ error: 'Unknown agent' });
    store.set(req.body.id, null); res.json({ ok: true });
  });
  app.post('/api/hub/health', async (req, res) => {
    try { res.json(await bus.adapter(req.body.id).health()); }
    catch (error) { res.status(502).json({ error: error.message }); }
  });
  app.get('/api/hub/presets', (_req, res) => res.json({ presets: store.get('_presets') || [] }));
  app.post('/api/hub/presets', (req, res) => {
    const { name, mode, agentIds, privateOnly } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || !MODES.includes(mode) || !Array.isArray(agentIds) || !agentIds.length || agentIds.some(id => !bus.registry().some(a => a.id === id))) return res.status(400).json({ error: 'Invalid preset' });
    const presets = (store.get('_presets') || []).filter(p => p.name !== name).slice(-19);
    presets.push({ name, mode, agentIds: [...new Set(agentIds)], privateOnly: !!privateOnly });
    store.set('_presets', presets); res.json({ presets });
  });
  let active = 0;
  app.post('/api/hub/run', async (req, res) => {
    if (active >= 2) return res.status(429).json({ error: 'Two workflows are already active' });
    active++;
    res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
    const controller = new AbortController(); res.on('close', () => controller.abort());
    const emit = event => { if (!res.destroyed) res.write(JSON.stringify({ ...event, timestamp: Date.now() }) + '\n'); };
    try { await bus.run(req.body, emit, controller.signal); }
    catch (error) { emit({ type: 'error', error: error.message }); }
    finally { active--; res.end(); }
  });
  app.use(express.static(path.resolve('dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  app.use((error, _req, res, _next) => res.status(400).json({ error: 'Invalid request body' }));
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.QUADRA_HUB_HOST || '127.0.0.1';
  if (host !== '127.0.0.1' && !process.env.QUADRA_HUB_TOKEN) throw new Error('Remote binding requires QUADRA_HUB_TOKEN');
  createCommandApp().listen(Number(process.env.QUADRA_HUB_PORT || 3002), host, () => console.log(`Quadra Agent Bus listening on ${host}:${process.env.QUADRA_HUB_PORT || 3002}`));
}
