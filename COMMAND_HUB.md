# Quadra local command hub

The new default interface is a provider-independent command room. The original
Atlantean workspace, Python backend, HRM, memory, learning, sync, simulations,
and existing utilities remain available through **Open Atlantean workspace**.

## Start locally

Install Node.js 22.12+ (Node 24 also works) and Ollama on the machine that will
run the hub. The orchestrator lives on that machine, not in a cloud deployment.

1. Run `npm ci` inside the project folder.
2. Install a local model: `ollama pull qwen3:8b`, then start Ollama if needed
   with `ollama serve`. You can use another installed model that reliably
   supports structured JSON outputs.
3. Optionally copy `.env.example` to `.env.local`. The Agent Bus does not need
   Gemini, Redis, or the Python backend to start.
4. In one terminal run `npm run hub`.
5. In another terminal run `npm run dev`.
6. Open http://localhost:3000. In **Agents & connections**, configure Ollama
   with its exact installed model name, save, and test.
7. Configure other agents using developer API credentials and exact model IDs
   available to your account. Consumer ChatGPT/Claude subscriptions are not
   API credentials. API usage and research tools can incur provider charges.
8. In **Command room**, select agents, select a mode, grant external-sharing
   permission if needed, and dispatch a request.

For a built local UI: `npm run build`, then `npm run hub` serves `dist` and the
API together at http://127.0.0.1:3002. No frontend development server is needed.

The legacy workspace still uses its original Python/Gemini configuration and
startup instructions. Its conversation history is separate from command-room
context. No Python scientific or memory implementation was replaced.

## Modes

| Mode | Execution |
| --- | --- |
| Single | Ollama chooses the requested sole agent; return its contribution. |
| Broadcast | Selected agents execute independently; Ollama synthesizes. |
| Sequential | Ollama plans agent order; each agent receives earlier results. A failed dependency stops the chain. |
| Debate | Independent first round, parallel peer critique, local synthesis. |
| Specialist | Ollama selects a subset using declared capabilities. |

Ollama always plans dispatch. If it is unavailable or returns an invalid plan,
the workflow fails visibly; there is no silent cloud-dispatch fallback. Plans
cannot select unapproved agents, duplicate agents, or exceed the selected set.
Broadcast and sequential plans must use every selected agent exactly once.
Each request supports up to 32 selected agents; the registry is not restricted
to four agents. **Add compatible agent** registers additional named agents.

## Connections and permissions

- OpenAI uses Chat Completions; Claude uses Messages; Grok uses Responses.
- Grok's **Enable web research tools** setting adds the provider's `web_search`
  tool and advertises research capabilities to the planner. Returned source
  URLs are preserved in its contribution and passed to synthesis. Tool use
  still depends on model/account support; a response is not proof of a search.
- MUSE and additional custom agents require an OpenAI-compatible chat API.
  No undocumented consumer-site automation or native MUSE API is assumed.
- Allow custom API endpoints explicitly with `QUADRA_AGENT_ENDPOINTS`, using
  exact base URLs. URLs with credentials/query/fragment are rejected, and
  HTTP redirects are not followed. Only allow servers you trust.
- Model IDs are user-configured, rather than guessed or pinned to aging models.
- Health testing checks actual inference for external providers, and checks
  Ollama's installed-model list locally. `Configured` does not mean healthy.
- Keys are sent once to the local hub and encrypted with AES-256-GCM in
  `.quadra-local/connections.enc`; its 0600 key file stays on that machine.
  This is an application vault, not an OS keychain. Protect the host and vault
  directory together. The directory is excluded from Git and the delivered ZIP.
- API keys are never included in public agent objects or browser storage.
- Local/private mode blocks cloud destinations. External permission covers
  the current message, included conversation context, and attached files.
- Cancelling aborts active requests; a provider may still bill work already
  accepted. Partial results remain available; failures are never called consensus.
- Presets persist in the encrypted local store, without external-sharing consent.

## Text, voice, documents, images

All inputs become `UserMessage` records with IDs, conversation IDs, timestamp,
source, and content parts. The browser sends the same record to the same bus.

Speech recognition uses the browser SpeechRecognition API where supported.
It requires explicit microphone consent and may send audio to the browser
vendor's service, even when agent routing is local/private. It is not offline
speech-to-text. Recognition populates the editable composer; dispatch is manual.
Text-to-speech uses browser speech synthesis with a stop-audio control.

Text, Markdown, CSV, Excel, DOCX, JSON, and text-based PDFs reuse the existing
file parser. Its extraction limit is 12,000 characters and the UI warns when
extraction is truncated. Scanned PDFs need OCR; no silent OCR is assumed.
PNG/JPEG/WebP images up to 1 MB are sent to selected vision-capable models.
Enable vision only for a model that actually supports it; all selected agents
must support vision for an image request. Ollama sees image metadata during
planning; selected vision agents receive image bytes during execution.
The HTTP request limit is 2 MB, including base64 images, attachments, and context.

Command-room turns stay in browser memory during the session. Context includes
the most recent six successful text exchanges; attachment bytes are not
replayed in later turns. Attach files again when the follow-up needs them.
Presets and connections persist; durable command-room history and a bridge
into Atlantean memory are future integration work.

## Mobile/tablet access

The UI adapts to mobile and tablet widths. By default, the hub binds only to
loopback. To use another device, keep Ollama on the host and put the hub behind
a trusted HTTPS reverse proxy serving both UI and API. Set a long random
`QUADRA_HUB_TOKEN`, allow the exact HTTPS UI origin in `QUADRA_HUB_ORIGINS`,
and configure `QUADRA_HUB_HOST` only if remote binding is required. Use the
UI's **Remote hub access** to enter the token (held in memory only).
Do not expose the unauthenticated Ollama port. Microphone access generally
requires HTTPS outside localhost. Cross-origin token preflight is not supported;
serve the UI and API from the same origin.

## Code boundaries

| Layer | Location | Responsibility |
| --- | --- | --- |
| UI | `ui/command-hub/` | Responsive command room, connection UI, voice, files, presets, contribution drilldown |
| Quadra Core | `core/agent-bus/` | Registry, permissions, plan validation, workflow execution, aggregation, vault |
| Local transport | `core/command-server.js` | Auth, endpoint policy, streaming events, health, connections, presets |
| Adapters | `agents/index.js` | Shared send/receive/health contract; Ollama, Chat Completions, Messages, Responses |
| Existing intelligence | `atlantean_core/`, `hrm/`, Python backend | Original memory and reasoning implementation |

The UI contains no provider-specific routing branches. Adapters encapsulate
wire formats. Custom agents register without changing conversation code.
Every contribution is visible; orchestration events stream immediately, while
individual model answers are currently returned as complete text, not token streams.
The bus passes bounded task context; it does not execute model-generated code
or expose filesystem/shell tools.

## Verification and limits

Run `npm run typecheck`, `npm test`, and `npm run build`.
Tests use deterministic fake adapters and local HTTP routes. They verify mode
semantics, local-only permissions, plan validation, cancellation, dependency
failure, partial results, vault persistence, redaction, endpoint policy,
registry expansion, provider formats, source preservation, and UI dispatch.
Live inference still requires your installed Ollama model and provider credentials.
This delivery is a working integration prototype, not a multi-tenant production
service. It has no per-user billing, durable job queue, or OAuth consumer agents.

Provider protocol references:
- https://docs.ollama.com/api/chat
- https://platform.claude.com/docs/en/api/messages/create
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://docs.x.ai/developers/tools/web-search
