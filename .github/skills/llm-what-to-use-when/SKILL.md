---
name: llm-what-to-use-when
description: Practical decision guide for choosing between Vercel AI SDK, LiteLLM, LightLLM, and direct provider SDKs based on runtime, deployment model, and constraints. Use when asked which LLM tooling to use for JS/TS apps, Python apps, static SPAs, or self-hosted inference.
---

# LLM Inference: What To Use When

A practical guide for choosing the right library or approach depending on your runtime, use case, and constraints.

## When to use this skill

Use this skill when you need to choose an LLM integration approach based on:
- Runtime and language (JS/TS vs Python)
- Hosting model (browser-only static site, backend app, or self-hosted inference)
- Portability needs (single provider vs multi-provider abstraction)
- Operational constraints (key handling, CORS, and gateway architecture)

---

## Quick Decision Chart

| Your situation | Use this |
|---|---|
| Python app, any provider | **LiteLLM** |
| JS/TS app with a backend (Node, Next.js, etc.) | **Vercel AI SDK** |
| Static SPA (GitHub Pages, no server) + npm build | **Vercel AI SDK** (direct browser mode) |
| Static SPA + no build step, vanilla JS | **Provider SDK direct** (e.g. `openai` via CDN) |
| Hosting/serving your own open-source model | **LightLLM** (inference server) |
| Both Python app and SPA, unified gateway | **LiteLLM proxy** + call it from both |

---

## Option 1: Vercel AI SDK (`ai`)

**Best for:** npm-bundled SPAs, React/Vue/Svelte apps, Next.js, static sites on GitHub Pages.

**Licence:** MIT ✅  
**npm:** `npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google`

### Strengths
- Multi-provider with a unified API — swap providers by changing one import
- First-class **tool use** and **structured output** (via Zod schemas with `generateObject`)
- **Agentic loops** via `maxSteps` in `generateText`
- Works in the browser with no backend required (direct provider calls)
- MCP (Model Context Protocol) support in AI SDK 6+
- Type-safe throughout

### Browser / Static Site Usage

For GitHub Pages or any static host, call providers directly from the browser. The user supplies their own API key (stored in memory only, never hardcoded).

```js
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'

const openai = createOpenAI({ apiKey: userSuppliedKey })

const { text, toolResults } = await generateText({
  model: openai('gpt-4o-mini'),
  tools: {
    rollDice: {
      description: 'Roll a die with N sides',
      parameters: z.object({ sides: z.number() }),
      execute: async ({ sides }) => Math.ceil(Math.random() * sides)
    }
  },
  maxSteps: 5,
  prompt: 'Roll a d20 and tell me if I hit AC 15'
})
```

Swapping to Anthropic or Gemini only changes the import and model string — all tool/structured output code stays identical.

### Provider CORS Notes

| Provider | Direct browser calls | Notes |
|---|---|---|
| OpenAI | ✅ Works | Most permissive |
| Google Gemini | ✅ Works | Good CORS support |
| Anthropic | ⚠️ Requires flag | Pass `dangerouslyAllowBrowser: true` to `createAnthropic()` |
| Ollama (local) | ✅ Works | localhost only; not useful for deployed static sites |

### Structured Output Example

```js
import { generateObject } from 'ai'
import { z } from 'zod'

const { object } = await generateObject({
  model: openai('gpt-4o-mini'),
  schema: z.object({
    enemyName: z.string(),
    hp: z.number(),
    abilities: z.array(z.string())
  }),
  prompt: 'Generate a fantasy RPG enemy for a level 5 party'
})
// object.enemyName, object.hp, object.abilities are all typed
```

### Key Caveat for Static Sites

API keys in client-side code are visible to anyone who opens DevTools. The safest UX pattern is:
- Prompt the user to enter their own API key on first use
- Store it in `sessionStorage` or in-memory only (never `localStorage` for sensitive keys)
- Never commit a key to your repo

---

## Option 2: LiteLLM (Python)

**Best for:** Python scripts, FastAPI/Flask backends, data pipelines, CLI tools.

**Licence:** MIT ✅  
**Install:** `pip install litellm`

### Strengths
- Unified `completion()` call across 100+ providers (OpenAI, Anthropic, Gemini, Mistral, Bedrock, Ollama, etc.)
- Drop-in OpenAI SDK replacement
- Tool use and structured output supported
- Can run as a **proxy server** (OpenAI-compatible REST API) — useful for serving SPAs too

### Basic Usage

```python
from litellm import completion

response = completion(
    model="gpt-4o-mini",          # or "claude-3-haiku", "gemini/gemini-1.5-flash", etc.
    messages=[{"role": "user", "content": "Hello!"}],
    api_key=os.environ["OPENAI_API_KEY"]
)
print(response.choices[0].message.content)
```

### LiteLLM as a Proxy (Unified Gateway)

Run once, call from anywhere — Python apps, SPAs, curl:

```bash
litellm --model gpt-4o-mini --port 8000
```

Your SPA can then call `http://localhost:8000/v1/chat/completions` with OpenAI-format JSON. In production, deploy to a cheap VPS/container.

---

## Option 3: LightLLM (Self-Hosted Inference)

**Best for:** Hosting your *own* open-source models (LLaMA, Mistral, Qwen, etc.) on GPU hardware.

**Licence:** Apache 2.0  
**Not for:** Calling external APIs like OpenAI or Anthropic

LightLLM is an inference *server*, not a client SDK. You'd use it if you're running models yourself and want a fast, production-ready serving layer. Your app would then call *it* via HTTP, and you'd use LiteLLM or the Vercel AI SDK to talk to it.

---

## Option 4: Direct Provider SDKs

**Best for:** Simple use cases, no dependency on a wrapper library, vanilla JS with a CDN import.

| Provider | JS package | Python package |
|---|---|---|
| OpenAI | `openai` | `openai` |
| Anthropic | `@anthropic-ai/sdk` | `anthropic` |
| Google Gemini | `@google/generative-ai` | `google-generativeai` |

Each has tool use and structured output but in their own format. You lose portability — switching providers means rewriting call sites.

---

## Scenarios: Your Specific Stack

### Idle game SPA on `timeless.github.io/idlegames`

**Recommended:** Vercel AI SDK in direct browser mode.

```
npm install ai @ai-sdk/openai zod
```

- User pastes their OpenAI (or Gemini) key into a settings panel
- Call `generateText` or `generateObject` directly in JS
- Tools let the LLM interact with game state (check resources, trigger events, etc.)
- Structured output means you get typed JSON back, not text to parse

### Python utility / automation script

**Recommended:** LiteLLM.

```
pip install litellm
```

- Same `completion()` call regardless of provider
- Easy to swap models for cost/speed tuning
- Works well in async contexts with `acompletion()`

### You want the same provider/model logic in both

**Option A:** Use LiteLLM as a proxy server, call it from both Python (directly) and the SPA (via HTTP). One config, all providers.

**Option B:** Accept that the Python and JS codebases use different libraries (LiteLLM and AI SDK respectively) but follow the same conceptual pattern — both support tools and structured output with near-identical mental models.

---

## Summary

| Library | Runtime | Multi-provider | Tools | Structured output | MIT licence | Browser-native |
|---|---|---|---|---|---|---|
| Vercel AI SDK | JS/TS | ✅ | ✅ | ✅ (Zod) | ✅ | ✅ |
| LiteLLM | Python | ✅ | ✅ | ✅ | ✅ | ❌ |
| LightLLM | Python (server) | ❌ (self-host only) | — | — | Apache 2.0 | ❌ |
| openai (direct) | JS + Python | ❌ | ✅ | ✅ | MIT | ⚠️ |
| anthropic (direct) | JS + Python | ❌ | ✅ | ✅ | MIT | ⚠️ |

**Bottom line for your projects:**
- **Static SPAs on GitHub Pages** → Vercel AI SDK, direct browser mode, user-supplied key
- **Python apps** → LiteLLM
- **Want one gateway for both** → LiteLLM proxy + call it from everywhere
