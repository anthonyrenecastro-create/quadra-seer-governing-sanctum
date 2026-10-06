import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentBus } from '../core/agent-bus/bus.js';
import { CredentialStore } from '../core/agent-bus/store.js';
import { AgentAdapter } from '../agents/index.js';
import { createCommandApp } from '../core/command-server.js';
const input = (mode='broadcast', extra={}) => ({ mode, agentIds:['openai','anthropic'], allowExternal:true, message:{id:'m',conversationId:'c',source:'text',content:[{type:'text',text:'Research this'}]}, ...extra });
function fixture({fail,plan}={}) {
  const data={ollama:{config:{},key:null},openai:{config:{},key:'secret'},anthropic:{config:{},key:'secret'}};
  const store={get:id=>data[id],set:(id,value)=>data[id]=value}; const calls=[]; const events=[];
  const bus=new AgentBus(store,(config)=>({send:async (request,signal)=>{
    calls.push({id:config.id,...request});
    if(signal?.aborted) throw new Error('Cancelled');
    if(config.id===fail) throw new Error('provider unavailable');
    if(config.id==='ollama' && request.format) return JSON.stringify(plan || {steps:JSON.parse(request.prompt).agents.map(a=>({agent:a.id,instruction:'Analyze'}))});
    return `Answer from ${config.id}`;
  }})); return {bus,calls,events,store,emit:e=>events.push(e)};
}
test('broadcast returns independent results and local synthesis',async()=>{const f=fixture(); const r=await f.bus.run(input(),f.emit); assert.equal(r.results.length,2);assert.equal(r.answer,'Answer from ollama'); assert.equal(f.events.at(-1).type,'done');});
test('single routes exactly one answer',async()=>{const f=fixture();const r=await f.bus.run(input('single',{agentIds:['openai']}),f.emit);assert.equal(r.answer,'Answer from openai');});
test('sequential supplies previous outputs to downstream agent',async()=>{const f=fixture();await f.bus.run(input('sequential'),f.emit);assert.match(f.calls.find(c=>c.id==='anthropic').prompt,/Answer from openai/);});
test('debate performs peer critique before synthesis',async()=>{const f=fixture();const r=await f.bus.run(input('debate'),f.emit);assert.equal(r.results.length,4);assert.equal(r.results.filter(x=>x.round===2).length,2);assert.match(f.calls.filter(c=>c.id==='anthropic')[1].prompt,/Answer from openai/);});
test('specialist executes a capability-selected subset',async()=>{const f=fixture({plan:{steps:[{agent:'anthropic',instruction:'Reason'}]}});const r=await f.bus.run(input('specialist'),f.emit);assert.equal(r.results.length,1);});
test('privacy and missing sharing permission reject before dispatch',async()=>{for(const extra of [{privateOnly:true},{allowExternal:false}]){const f=fixture();await assert.rejects(f.bus.run(input('broadcast',extra),f.emit),/permission/);assert.equal(f.calls.length,0);}});
test('private workflow never calls external adapters',async()=>{const f=fixture();await f.bus.run(input('single',{agentIds:['ollama'],privateOnly:true,allowExternal:false}),f.emit);assert.ok(f.calls.every(c=>c.id==='ollama'));});
test('unselected or repeated planned agents are rejected',async()=>{for(const steps of [[{agent:'xai',instruction:'x'}],[{agent:'openai',instruction:'x'},{agent:'openai',instruction:'x'}]]){const f=fixture({plan:{steps}});await assert.rejects(f.bus.run(input(),f.emit),/permissions/);assert.equal(f.calls.length,1);}});
test('partial broadcast failures remain visible',async()=>{const f=fixture({fail:'anthropic'});const r=await f.bus.run(input(),f.emit);assert.equal(r.results.find(r=>r.agentId==='anthropic').status,'failed');assert.equal(f.events.at(-1).partial,true);});
test('sequential dependency failure stops downstream dispatch',async()=>{const f=fixture({fail:'openai'});await assert.rejects(f.bus.run(input('sequential'),f.emit),/dependency/);assert.ok(!f.calls.some(c=>c.id==='anthropic'));});
test('local orchestration failure has no cloud fallback',async()=>{const f=fixture({fail:'ollama'});await assert.rejects(f.bus.run(input(),f.emit),/unavailable/);assert.equal(f.calls.length,1);});
test('abort signal propagates',async()=>{const f=fixture();const c=new AbortController();c.abort();await assert.rejects(f.bus.run(input(),f.emit,c.signal),/Cancelled/);});
test('image input requires declared vision capability',async()=>{const f=fixture();await assert.rejects(f.bus.run(input('single',{agentIds:['openai'],message:{id:'i',conversationId:'c',source:'image',content:[{type:'image',data:'YWJj',mimeType:'image/png'}]}}),f.emit),/vision/);assert.equal(f.calls.length,0);});
test('vault encrypts, restores, and disconnects credentials',()=>{const dir=mkdtempSync(path.join(tmpdir(),'quadra-test-'));try{const s=new CredentialStore(dir);s.set('a',{key:'top-secret'});assert.ok(!readFileSync(path.join(dir,'connections.enc'),'utf8').includes('top-secret'));const restored=new CredentialStore(dir);assert.equal(restored.get('a').key,'top-secret');restored.set('a',null);assert.equal(new CredentialStore(dir).get('a'),undefined);}finally{rmSync(dir,{recursive:true,force:true});}});
test('provider adapters send correct formats and never echo remote error bodies',async()=>{for(const protocol of ['ollama','openai','anthropic']){let call;const a=new AgentAdapter({endpoint:'http://localhost',protocol,model:'m'},'key',async(url,options)=>{call={url,...options};return {ok:true,json:async()=>protocol==='ollama'?{message:{content:'ok'}}:protocol==='anthropic'?{content:[{type:'text',text:'ok'}]}:{choices:[{message:{content:'ok'}}]}};});assert.equal(await a.send({prompt:'hello',images:[{data:'YWJj',mimeType:'image/png'}]}),'ok');const body=JSON.parse(call.body);assert.ok(body.messages);if(protocol==='anthropic')assert.equal(call.headers['x-api-key'],'key');if(protocol==='ollama')assert.deepEqual(body.messages[1].images,['YWJj']);else assert.ok(Array.isArray(body.messages.at(-1).content));}
const a=new AgentAdapter({endpoint:'http://localhost',protocol:'openai'},'secret',async()=>({ok:false,status:401}));await assert.rejects(a.send({prompt:'x'}),/^Error: Provider returned HTTP 401$/);});
test('hub routes redact keys, restrict origins/endpoints, and persist presets',async()=>{const data={};const app=createCommandApp({get:id=>data[id],set:(id,v)=>data[id]=v});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/hub/`;const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});try{
assert.equal((await fetch(base+'agents',{headers:{Origin:'https://evil.test'}})).status,403);
assert.equal((await post('connect',{id:'custom',model:'m',endpoint:'http://169.254.169.254',key:'secret'})).status,400);
assert.equal((await post('connect',{id:'openai',model:'model-from-account',key:'secret'})).status,200);
const raw=await(await fetch(base+'agents')).text();assert.ok(!raw.includes('secret'));assert.ok(raw.includes('configured'));
assert.equal((await post('presets',{name:'Research',mode:'broadcast',agentIds:['openai']})).status,200);
assert.equal((await(await fetch(base+'presets')).json()).presets.length,1);
await post('disconnect',{id:'openai'});assert.equal(data.openai,null);
}finally{await new Promise(r=>server.close(r));}});
test('registry supports more than four agents without changing the UI protocol',()=>{const f=fixture();f.store.set('_registry',Array.from({length:12},(_,i)=>({id:`custom-${i}`,name:`Agent ${i}`,protocol:'openai',endpoint:'https://example.test/v1',model:'m',capabilities:['reasoning']})));assert.equal(f.bus.list().length,18);});
test('web research adapter preserves sources and explicitly enables tools',async()=>{let body;const a=new AgentAdapter({protocol:'responses',endpoint:'https://api.x.ai/v1',model:'m',webSearch:true},'key',async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:'Finding',annotations:[{type:'url_citation',url:'https://example.test/evidence',title:'Evidence'}]}]}]})};});const result=await a.send({prompt:'Check current facts'});assert.equal(body.tools[0].type,'web_search');assert.match(result,/https:\/\/example.test\/evidence/);await a.health();assert.equal(body.tools,undefined);});
test('HTTP workflow streams a real adapter dispatch through the local bus',async()=>{
  const {createServer}=await import('node:http');const mock=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);res.setHeader('Content-Type','application/json');if(req.url==='/local/api/chat')res.end(JSON.stringify({message:{content:body.format?JSON.stringify({steps:[{agent:'openai',instruction:'Analyze this'}]}):'Local synthesis'}}));else res.end(JSON.stringify({choices:[{message:{content:'External contribution'}}]}));});
  mock.listen(0,'127.0.0.1');await new Promise(r=>mock.once('listening',r));const mockBase=`http://127.0.0.1:${mock.address().port}`;
  const data={ollama:{config:{endpoint:mockBase+'/local',model:'local'}},openai:{config:{endpoint:mockBase+'/external',model:'external'},key:'test-key'}};
  const server=createCommandApp({get:id=>data[id],set:(id,v)=>data[id]=v}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/hub/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input('single',{agentIds:['openai']}))});assert.equal(response.status,200);const events=(await response.text()).trim().split('\n').map(JSON.parse);assert.ok(events.some(e=>e.type==='plan'));assert.ok(events.some(e=>e.type==='result'&&e.text==='External contribution'));assert.equal(events.at(-1).answer,'External contribution');}
  finally{await new Promise(r=>server.close(r));await new Promise(r=>mock.close(r));}
});
