import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CommandHub from './CommandHub';
import { api, run } from './client';
vi.mock('./client', () => ({ api: vi.fn(), run: vi.fn(), setHubToken: vi.fn() }));
const agents = [{id:'ollama',name:'Ollama',local:true,status:'configured',capabilities:['private'],model:'qwen3:8b',endpoint:'http://127.0.0.1:11434'}, {id:'openai',name:'ChatGPT / OpenAI',status:'configured',capabilities:['coding'],model:'m',endpoint:'https://api.openai.com/v1'}];
beforeEach(() => {
  vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api).mockImplementation(async(route) => route === 'agents' ? {agents} : route === 'presets' ? {presets:[]} : {ok:true});
  vi.mocked(run).mockImplementation(async(_body,onEvent) => { onEvent({type:'plan',steps:[{agent:'ollama',instruction:'Analyze'}]});onEvent({type:'result',agentId:'ollama',round:1,status:'completed',text:'Local contribution'});onEvent({type:'done',answer:'Final synthesis'}); });
});
afterEach(cleanup);
describe('Command hub', () => {
  it('dispatches normalized messages and displays contributions',async()=>{
    render(<CommandHub onLegacy={()=>{}}/>);
    await screen.findByRole('button',{name:'Ollama'});
    fireEvent.click(screen.getByRole('button',{name:'Ollama'}));
    fireEvent.click(screen.getByRole('button',{name:'single'}));
    fireEvent.change(screen.getByLabelText('Your request'),{target:{value:'Analyze this'}});
    fireEvent.click(screen.getByRole('button',{name:'Dispatch →'}));
    await screen.findByText('Final synthesis');
    expect(vi.mocked(run).mock.calls[0][0]).toMatchObject({mode:'single',agentIds:['ollama'],message:{source:'text',content:[{type:'text',text:'Analyze this'}]}});
    expect(screen.getByText('Local contribution')).toBeTruthy();
    expect(screen.getByText('Dispatch plan')).toBeTruthy();
  });
  it('private mode removes external selections and disables sharing',async()=>{
    render(<CommandHub onLegacy={()=>{}}/>);
    await screen.findByRole('button',{name:'ChatGPT / OpenAI'});
    fireEvent.click(screen.getByRole('button',{name:'ChatGPT / OpenAI'}));
    fireEvent.click(screen.getByLabelText('Local / private only'));
    expect((screen.getByRole('button',{name:'ChatGPT / OpenAI'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your request'),{target:{value:'Private request'}});
    fireEvent.click(screen.getByRole('button',{name:'Dispatch →'}));
    await screen.findByText('Select at least one connected agent.');expect(run).not.toHaveBeenCalled();
  });
  it('saves a connection without putting credentials in storage',async()=>{
    const storage = vi.spyOn(Storage.prototype,'setItem');
    render(<CommandHub onLegacy={()=>{}}/>);await screen.findByRole('button',{name:'Ollama'});
    fireEvent.click(screen.getByRole('button',{name:'Agents & connections'}));
    fireEvent.change(screen.getByLabelText('Agent'),{target:{value:'openai'}});
    fireEvent.change(screen.getByLabelText('API key'),{target:{value:'test-secret'}});
    fireEvent.click(screen.getByRole('button',{name:'Save connection'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('connect',expect.objectContaining({key:'test-secret',id:'openai'})));
    expect(storage).not.toHaveBeenCalled();storage.mockRestore();
    await waitFor(()=>expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(''));
  });
});
