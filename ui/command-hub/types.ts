export type Mode = 'single' | 'broadcast' | 'sequential' | 'debate' | 'specialist';
export interface UserMessage {
  id: string; conversationId: string; timestamp: number;
  source: 'text' | 'voice' | 'image' | 'file';
  content: Array<{ type: 'text' | 'file' | 'image'; text?: string; name?: string; data?: string; mimeType?: string }>;
}
export interface Agent { id: string; name: string; capabilities: string[]; status: string; model: string; endpoint: string; local?: boolean; supportsWebSearch?: boolean; webSearch?: boolean }
export interface Preset { name: string; mode: Mode; agentIds: string[]; privateOnly: boolean }
export interface BusEvent { type: string; phase?: string; agentId?: string; status?: string; text?: string; error?: string; answer?: string; round?: number; partial?: boolean; steps?: Array<{agent: string; instruction: string}> }
