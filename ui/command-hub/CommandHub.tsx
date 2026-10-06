import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { api, run, setHubToken } from './client';
import { Agent, BusEvent, Mode, Preset, UserMessage } from './types';
import './hub.css';
const modes: Mode[] = ['single', 'broadcast', 'sequential', 'debate', 'specialist'];
const descriptions: Record<Mode,string> = { single: 'One agent, your choice.', broadcast: 'Independent answers, local synthesis.', sequential: 'Each agent builds on the previous result.', debate: 'Independent answers, peer critique, local synthesis.', specialist: 'Ollama routes by declared capabilities.' };
type Turn = { id: string; question: string; events: BusEvent[]; answer?: string; error?: string };
export default function CommandHub({ onLegacy }: { onLegacy: () => void }) {
  const [page, setPage] = useState('conversation'); const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string[]>([]); const [mode, setMode] = useState<Mode>('broadcast');
  const [presets, setPresets] = useState<Preset[]>([]); const [presetName, setPresetName] = useState('');
  const [text, setText] = useState(''); const [privateOnly, setPrivate] = useState(false); const [external, setExternal] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [customName, setCustomName] = useState('');
  const [editId, setEditId] = useState('ollama'); const [model, setModel] = useState('qwen3:8b'); const [endpoint, setEndpoint] = useState('http://127.0.0.1:11434'); const [key, setKey] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [vision, setVision] = useState(false);
  const [health, setHealth] = useState<Record<string,string>>({}); const [testing, setTesting] = useState(false);
  const [listening, setListening] = useState(false); const [voiceConsent, setVoiceConsent] = useState(false); const [speak, setSpeak] = useState(false);
  const [attachments, setAttachments] = useState<UserMessage['content']>([]); const [parsing, setParsing] = useState(false); const [token, setToken] = useState('');
  const source = useRef<UserMessage['source']>('text'); const recognition = useRef<any>(null); const abort = useRef<AbortController | null>(null);
  const conversationId = useRef(crypto.randomUUID()); const bottom = useRef<HTMLDivElement>(null);
  async function refresh() {
    try { const [a,p] = await Promise.all([api('agents'), api('presets')]); setAgents(a.agents); setPresets(p.presets); setNotice(''); }
    catch (e: any) { setNotice(`${e.message}. Start the local hub with npm run hub.`); }
  }
  useEffect(() => { refresh(); return () => { abort.current?.abort(); recognition.current?.stop(); window.speechSynthesis?.cancel(); }; }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);
  const toggle = (id: string) => setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : mode === 'single' ? [id] : [...ids,id]);
  const choose = (a: Agent) => { setEditId(a.id); setModel(a.model); setEndpoint(a.endpoint); setKey(''); setVision(a.capabilities.includes('vision')); setWebSearch(!!a.webSearch); };
  async function connect() {
    setTesting(true);
    try { await api('connect', { id: editId, model, endpoint, key, vision, webSearch, name: customName }); setKey(''); await refresh(); setHealth(h => ({ ...h, [editId]: 'Configured — test connection' })); }
    catch (e:any) { setNotice(e.message); } finally { setTesting(false); }
  }
  async function test(a: Agent) {
    setTesting(true);
    try { const h = await api('health', { id: a.id }); setHealth(old => ({ ...old, [a.id]: h.modelAvailable ? 'Healthy · model available' : `Reachable · model missing. Installed: ${h.models.join(', ')}` })); }
    catch (e:any) { setHealth(old => ({ ...old, [a.id]: e.message })); } finally { setTesting(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault(); if (busy || parsing || (!text.trim() && !attachments.length)) return;
    if (!selected.length) { setNotice('Select at least one connected agent.'); return; }
    if (mode === 'single' && selected.length !== 1) { setNotice('Single mode requires exactly one agent.'); return; }
    const id = crypto.randomUUID(); const question = text.trim();
    const message: UserMessage = { id, conversationId: conversationId.current, timestamp: Date.now(), source: attachments.some(a => a.type === 'image') ? 'image' : attachments.length ? 'file' : source.current, content: [...(question ? [{ type: 'text' as const, text: question }] : []), ...attachments] };
    const history = turns.filter(t => t.answer).slice(-6).flatMap(t => [{ role: 'user', text: t.question }, { role: 'assistant', text: t.answer }]);
    setTurns(old => [...old,{ id, question: question || 'Analyze attached files', events: [] }]); setText(''); setAttachments([]); source.current = 'text'; setBusy(true); setNotice('');
    abort.current = new AbortController();
    const update = (e: BusEvent) => {
      setTurns(old => old.map(t => t.id === id ? { ...t, events: [...t.events,e], ...(e.type === 'done' ? { answer: e.answer } : {}), ...(e.type === 'error' ? { error: e.error } : {}) } : t));
      if (e.type === 'done' && speak && window.speechSynthesis && e.answer) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(e.answer)); }
    };
    try { await run({ message, mode, agentIds: selected, privateOnly, allowExternal: external, history }, update, abort.current.signal); }
    catch (e:any) { update({ type: 'error', error: e.name === 'AbortError' ? 'Workflow cancelled.' : e.message }); }
    finally { setBusy(false); abort.current = null; }
  }
  function startVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) { setNotice('Speech recognition is unavailable in this browser. Text input remains available.'); return; }
    if (!voiceConsent) { setNotice('Enable the voice permission below first. Your browser may send microphone audio to its speech service.'); return; }
    const rec = new Recognition(); recognition.current = rec; rec.lang = navigator.language; rec.continuous = false; rec.interimResults = false;
    rec.onresult = (e:any) => { setText(old => `${old} ${e.results[0][0].transcript}`.trim()); source.current = 'voice'; };
    rec.onerror = (e:any) => { setNotice(`Microphone: ${e.error}`); setListening(false); };
    rec.onend = () => setListening(false); try { rec.start(); setListening(true); } catch { setNotice('Could not start microphone.'); }
  }
  async function attach(files: FileList | null) {
    if (!files) return; setParsing(true);
    const { parseFile } = await import('../../utils/fileParser');
    try { const parsed = await Promise.all(Array.from(files).map(async file => {
      if (file.type.startsWith('image/')) {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 1000000) throw new Error('Use PNG, JPEG, or WebP images under 1 MB.');
        const data = await parseFile(file); return { type: 'image' as const, data: data.content, mimeType: file.type, name: file.name };
      }
      const data = await parseFile(file); if (!data.extractedText?.trim()) throw new Error(`No text found in ${file.name}. Scanned documents need OCR.`);
      if (data.extractedText.includes('[TRUNCATED]')) setNotice(`Only the first portion of ${file.name} was extracted. Narrow the document for complete coverage.`);
      if (data.extractedText.length > 100000) throw new Error('Attachment text exceeds the 100,000 character context limit.');
      return { type: 'file' as const, text: data.extractedText, name: file.name };
    })); setAttachments(old => [...old,...parsed]); }
    catch(e:any) { setNotice(e.message); } finally { setParsing(false); }
  }
  async function savePreset() { try { const p = await api('presets', { name: presetName, mode, agentIds: selected, privateOnly }); setPresets(p.presets); setPresetName(''); } catch(e:any) { setNotice(e.message); } }
  const name = (id?:string) => agents.find(a => a.id === id)?.name || id;
  return <div className="qh">
    <aside className="qh-sidebar"><div className="qh-brand"><span className="qh-mark">Q</span><div>QUADRA<small>LOCAL COMMAND HUB</small></div></div>
      <nav>{[['conversation','Command room'],['agents','Agents & connections'],['presets','Workflow presets']].map(([id,label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav>
      <div className="qh-sidebar-bottom"><span className="qh-dot"/> Ollama coordinates locally<p>One mission. Many perspectives.<br/>You control the connections.</p><button onClick={onLegacy}>Open Atlantean workspace ↗</button></div>
    </aside>
    <main className="qh-main"><header><div><span className="qh-eyebrow">AXIOM ZETA / QUADRA SEER</span><h1>{page === 'conversation' ? 'Command room' : page === 'agents' ? 'Your agent network' : 'Saved workflows'}</h1></div><button disabled={busy} onClick={() => { setTurns([]); conversationId.current = crypto.randomUUID(); }}>New conversation</button></header>
    {notice && <div role="alert" className="qh-notice">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
    {page === 'conversation' && <><section className="qh-toolbar"><div className="qh-modes">{modes.map(m => <button key={m} className={mode === m ? 'active' : ''} disabled={busy} onClick={() => { setMode(m); if(m === 'single') setSelected(old => old.slice(0,1)); }}>{m}</button>)}</div><p>{descriptions[mode]}</p>
      <div className="qh-agent-chips">{agents.map(a => <button key={a.id} disabled={busy || a.status === 'disconnected' || (privateOnly && !a.local)} className={selected.includes(a.id) ? 'selected' : ''} onClick={() => toggle(a.id)}><span className={`qh-dot ${a.status === 'disconnected' ? 'off' : ''}`}/>{a.name}{selected.includes(a.id) && mode === 'sequential' ? ` · ${selected.indexOf(a.id)+1}` : ''}</button>)}</div>
      <div className="qh-permissions"><label><input type="checkbox" checked={privateOnly} disabled={busy} onChange={e => { setPrivate(e.target.checked); if(e.target.checked) { setExternal(false); setSelected(ids => ids.filter(id => agents.find(a => a.id === id)?.local)); } }}/> Local / private only</label><label><input type="checkbox" checked={external} disabled={busy || privateOnly} onChange={e => setExternal(e.target.checked)}/> Allow selected external agents to receive this conversation and attachments</label></div>
    </section>
    <section className="qh-conversation" aria-live="polite">{!turns.length && <div className="qh-welcome"><span className="qh-orbit">✦</span><h2>A mission for your whole network.</h2><p>Ask a question, assemble a team, and inspect every contribution.<br/>Your local Ollama model plans the work and brings the results together.</p><div className="qh-examples">{['Analyze this project, challenge its assumptions, and propose an experiment.', 'Compare the approaches and preserve any disagreements.'].map(s => <button key={s} onClick={() => setText(s)}>{s} ↗</button>)}</div><button onClick={() => setPage('agents')}>Connect your first agents →</button></div>}
      {turns.map(t => <article key={t.id} className="qh-turn"><div className="qh-question"><small>YOU</small><p>{t.question}</p></div><div className="qh-response"><small>QUADRA / AGENT BUS</small>
      {t.events.filter(e => e.type === 'phase').map((e,i) => <div className="qh-phase" key={i}>Ollama · {e.phase}</div>)}
      {t.events.filter(e => e.type === 'plan').map((e,i) => <details key={i}><summary>Dispatch plan</summary>{e.steps?.map(s => <p key={s.agent}><b>{name(s.agent)}</b> · {s.instruction}</p>)}</details>)}
      {t.events.filter(e => e.type === 'agent' && !t.events.some(r => r.type === 'result' && r.agentId === e.agentId && r.round === e.round) && !t.error).map((e,i) => <div className="qh-phase" key={i}>{name(e.agentId)} · working{e.round === 2 ? ' / critique' : ''}…</div>)}
      {t.answer && <div className="qh-answer"><ReactMarkdown>{t.answer}</ReactMarkdown></div>}
      {t.error && <p className="qh-error">{t.error}</p>}
      {t.events.filter(e => e.type === 'result').map((e,i) => <details key={i} className="qh-contribution"><summary><span>{name(e.agentId)}{e.round === 2 ? ' / critique' : ''}</span><small>{e.status}</small></summary>{e.text ? <ReactMarkdown>{e.text}</ReactMarkdown> : <p className="qh-error">{e.error}</p>}</details>)}
      </div></article>)}<div ref={bottom}/></section>
    <form className="qh-composer" onSubmit={send}>{attachments.map((a,i) => <span className="qh-file" key={i}>{a.name} <button type="button" onClick={() => setAttachments(old => old.filter((_,j) => i !== j))}>×</button></span>)}<textarea aria-label="Your request" placeholder="Give your network a mission…" value={text} disabled={busy} onChange={e => { setText(e.target.value); source.current = 'text'; }}/><div className="qh-composer-actions"><div><label className="qh-upload">{parsing ? 'Reading…' : '+ Attach'}<input aria-label="Attach documents" type="file" multiple disabled={busy || parsing} accept=".txt,.md,.csv,.xlsx,.xls,.pdf,.docx,.json,.png,.jpg,.jpeg,.webp" onChange={e => { attach(e.target.files); e.target.value = ''; }}/></label><button type="button" disabled={busy} className={listening ? 'active' : ''} onClick={startVoice}>{listening ? 'Stop microphone' : 'Microphone'}</button></div>{busy ? <button type="button" onClick={() => abort.current?.abort()}>Cancel workflow</button> : <button className="qh-primary" disabled={parsing || (!text.trim() && !attachments.length)} type="submit">Dispatch →</button>}</div><div className="qh-voice-settings"><label><input type="checkbox" checked={voiceConsent} onChange={e => { setVoiceConsent(e.target.checked); if(!e.target.checked) recognition.current?.stop(); }}/> Allow browser speech recognition (may process audio externally)</label><label><input type="checkbox" checked={speak} onChange={e => { setSpeak(e.target.checked); if(!e.target.checked) window.speechSynthesis?.cancel(); }}/> Speak answers</label><button type="button" onClick={() => window.speechSynthesis?.cancel()}>Stop audio</button></div></form></>}
    {page === 'agents' && <section className="qh-settings"><p className="qh-intro">Connect API-backed agents once. Keys are encrypted in the local server vault and never saved in the browser. Configured connections need a health test. Consumer subscriptions do not automatically grant API access.</p><button onClick={() => { setEditId('custom-' + crypto.randomUUID()); setCustomName(''); setModel(''); setEndpoint(''); setKey(''); setVision(false); setWebSearch(false); }}>+ Add compatible agent</button><div className="qh-agent-grid">{agents.map(a => <article className="qh-agent-card" key={a.id}><div className="qh-card-heading"><span className="qh-avatar">{a.name.charAt(0)}</span><div><h2>{a.name}</h2><small>{a.local ? 'Local · ' : ''}{a.status}</small></div></div><p>{a.capabilities.join(' · ')}</p><p className="qh-health">{health[a.id] || 'Not tested in this session'}</p><div><button onClick={() => choose(a)}>Configure</button><button disabled={testing || a.status === 'disconnected'} onClick={() => test(a)}>Test</button><button disabled={a.status === 'disconnected'} onClick={async () => { try { await api('disconnect',{id:a.id}); setSelected(old => old.filter(id => id !== a.id)); setHealth(h => ({...h,[a.id]:'Disconnected'})); await refresh(); } catch(e:any) { setNotice(e.message); } }}>Disconnect</button></div></article>)}</div>
    <div className="qh-connection"><h2>Configure {name(editId)}</h2>{!agents.some(a => a.id === editId) && <label>New agent name<input value={customName} onChange={e => setCustomName(e.target.value)}/></label>}<label>Agent<select value={editId} onChange={e => choose(agents.find(a => a.id === e.target.value)!)}>{!agents.some(a => a.id === editId) && <option value={editId}>New compatible agent</option>}{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Model ID<input value={model} onChange={e => setModel(e.target.value)} placeholder="Exact model available in your account"/></label><label>API base URL<input value={endpoint} onChange={e => setEndpoint(e.target.value)}/></label>{!agents.find(a => a.id === editId)?.local && <label>API key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)}/></label>}<label><span><input type="checkbox" checked={vision} onChange={e => setVision(e.target.checked)}/> This model supports vision (required for image input)</span></label>{agents.find(a => a.id === editId)?.supportsWebSearch && <label><span><input type="checkbox" checked={webSearch} onChange={e => setWebSearch(e.target.checked)}/> Enable web research tools (provider tool charges may apply)</span></label>}<p>MUSE / custom connections require an OpenAI-compatible chat API. Allow their exact endpoint in the server configuration first. Agents with web research enabled can retrieve current sources. Model capabilities depend on the selected model.</p><button className="qh-primary" disabled={testing} onClick={connect}>Save connection</button></div><details className="qh-connection"><summary>Remote hub access</summary><label>Hub token (memory only)<input type="password" value={token} onChange={e => setToken(e.target.value)}/></label><button onClick={() => { setHubToken(token); setToken(''); refresh(); }}>Unlock hub</button></details></section>}
    {page === 'presets' && <section className="qh-settings"><p>Save the current mode and agent selection. External-sharing permission is requested separately for each session.</p><div className="qh-connection"><label>Preset name<input value={presetName} onChange={e => setPresetName(e.target.value)}/></label><p>{mode} · {selected.map(id => name(id)).join(' → ') || 'Choose agents in the Command room'}</p><button disabled={!presetName.trim() || !selected.length} onClick={savePreset}>Save workflow</button></div>{presets.map(p => <article className="qh-agent-card" key={p.name}><h2>{p.name}</h2><p>{p.mode} · {p.agentIds.map(id => name(id)).join(' → ')}</p><button onClick={() => { setMode(p.mode); setSelected(p.agentIds); setPrivate(p.privateOnly); setExternal(false); setPage('conversation'); }}>Use preset →</button></article>)}</section>}
    </main></div>;
}
