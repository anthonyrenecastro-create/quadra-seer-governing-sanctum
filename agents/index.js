export const catalog = [
  { id: 'ollama', name: 'Ollama', protocol: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b', local: true, capabilities: ['reasoning', 'writing', 'coding', 'private'] },
  { id: 'openai', name: 'ChatGPT / OpenAI', protocol: 'openai', endpoint: 'https://api.openai.com/v1', model: '', capabilities: ['reasoning', 'writing', 'coding'] },
  { id: 'anthropic', name: 'Claude', protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1', model: '', capabilities: ['reasoning', 'writing', 'coding'] },
  { id: 'xai', name: 'Grok', supportsWebSearch: true, protocol: 'responses', endpoint: 'https://api.x.ai/v1', model: '', capabilities: ['reasoning', 'writing'] },
  { id: 'muse', name: 'MUSE', protocol: 'openai', endpoint: '', model: '', capabilities: ['writing'] },
  { id: 'custom', name: 'Compatible agent', protocol: 'openai', endpoint: '', model: '', capabilities: ['reasoning', 'coding'] },
];
export class AgentAdapter {
  constructor(config, credential, fetcher = fetch) { this.config = config; this.credential = credential; this.fetcher = fetcher; }
  async request(route, body, signal) {
    const { endpoint, protocol } = this.config;
    const headers = { 'Content-Type': 'application/json' };
    if (this.credential) {
      if (protocol === 'anthropic') { headers['x-api-key'] = this.credential; headers['anthropic-version'] = '2023-06-01'; }
      else headers.Authorization = `Bearer ${this.credential}`;
    }
    const response = await this.fetcher(endpoint.replace(/\/$/, '') + route, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(120000)])
    });
    // Do not echo remote bodies, which may include credentials or private prompts.
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return response.json();
  }
  async health(signal) {
    if (this.config.protocol === 'ollama') {
      const data = await this.request('/api/tags', undefined, signal);
      return { reachable: true, models: (data.models || []).map(m => m.name), modelAvailable: (data.models || []).some(m => m.name === this.config.model) };
    }
    // A bounded inference checks both authentication and chosen model.
    await this.send({ prompt: 'Reply OK.', maxTokens: 8, disableTools: true }, signal);
    return { reachable: true, modelAvailable: true };
  }
  receive(data) {
    if (this.config.protocol === 'ollama') return data.message?.content;
    if (this.config.protocol === 'responses') {
      const parts = (data.output || []).filter(p => p.type === 'message').flatMap(m => m.content || []);
      const text = parts.filter(p => p.type === 'output_text').map(p => p.text).join('\n');
      const links = [...new Map(parts.flatMap(p => p.annotations || []).filter(a => a.type === 'url_citation' && /^https?:\/\//.test(a.url)).map(a => [a.url, a])).values()];
      return text + (links.length ? '\n\nSources:\n' + links.map(a => `- ${a.url}`).join('\n') : '');
    }
    if (this.config.protocol === 'anthropic') return data.content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
    return data.choices?.[0]?.message?.content;
  }
  async send({ prompt, system = 'Respond accurately. Distinguish evidence from inference. Do not claim live web access or consensus without evidence.', maxTokens = 4096, format, images = [], disableTools = false }, signal) {
    const { protocol, model } = this.config;
    let route, body;
    if (protocol === 'ollama') {
      route = '/api/chat'; body = { model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt, ...(images.length ? { images: images.map(i => i.data) } : {}) }], options: { num_predict: maxTokens }, ...(format ? { format } : {}) };
    } else if (protocol === 'responses') {
      route = '/responses'; body = { model, store: false, instructions: system, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map(i => ({ type: 'input_image', image_url: `data:${i.mimeType};base64,${i.data}` }))] }], ...(this.config.webSearch && !disableTools ? { tools: [{ type: 'web_search' }] } : {}) };
    } else if (protocol === 'anthropic') {
      route = '/messages'; body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: images.length ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } }))] : prompt }] };
    } else {
      route = '/chat/completions'; body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: images.length ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))] : prompt }] };
    }
    const text = this.receive(await this.request(route, body, signal));
    if (typeof text !== 'string' || !text.trim()) throw new Error('Provider returned no text');
    return text;
  }
}
