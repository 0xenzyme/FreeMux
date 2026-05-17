# FreeMux

FreeMux is a local OpenAI-compatible proxy for OpenRouter free models. It exposes one stable model alias, `freemodel`, while routing requests to currently available free upstream models.

The goal is to let tools such as Hermes, OpenClaw, Aider, Continue, or any OpenAI-compatible CLI keep a stable configuration even when OpenRouter free model names change.

## MVP Scope

Included:

- `freemux serve`
- `freemux status`
- `freemux models`
- `GET /v1/models`
- non-streaming `POST /v1/chat/completions`
- OpenRouter free-model discovery
- model health state
- bounded fallback on upstream `429`, `404`, `5xx`, and network failures

Not included yet:

- streaming chat completions
- multi-provider routing
- paid fallback
- web UI
- benchmark-based quality scoring

## Install

For local development:

```bash
pnpm install
pnpm build
```

## Run

Create `.env` in the project directory:

```bash
OPENROUTER_API_KEY=sk-or-...
```

Then start the proxy:

```bash
pnpm freemux serve
```

You can also pass the key inline:

```bash
OPENROUTER_API_KEY=sk-or-... pnpm freemux serve
```

By default FreeMux listens on:

```text
http://127.0.0.1:4117/v1
```

The stable model alias is:

```text
freemodel
```

## Client Configuration

Use any OpenAI-compatible client config shape:

```text
base_url = http://127.0.0.1:4117/v1
model = freemodel
api_key = anything-local
```

For tools that require an API key even against local OpenAI-compatible endpoints, use any placeholder value. FreeMux uses `OPENROUTER_API_KEY` from its own environment when forwarding upstream.

## HTTP Example

```bash
curl -s http://127.0.0.1:4117/v1/models
```

```bash
curl -s http://127.0.0.1:4117/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "freemodel",
    "messages": [
      {"role": "user", "content": "Summarize this page."}
    ]
  }'
```

Successful responses include:

```text
x-freemux-upstream-model: actual/openrouter-free-model
```

## Commands

```bash
freemux serve
freemux status
freemux models
```

In development, use:

```bash
pnpm freemux --help
pnpm freemux status
```

## Configuration

Environment variables:

- `OPENROUTER_API_KEY` - required for `serve` and `models`
- `OPENROUTER_BASE_URL` - optional, defaults to `https://openrouter.ai/api/v1`
- `FREEMUX_HOST` - optional, defaults to `127.0.0.1`
- `FREEMUX_PORT` - optional, defaults to `4117`
- `FREEMUX_MODEL_ALIAS` - optional, defaults to `freemodel`
- `FREEMUX_STATE_PATH` - optional, defaults to `~/.freemux/state.json`
- `FREEMUX_MAX_ATTEMPTS` - optional, defaults to `3`
- `FREEMUX_REQUEST_TIMEOUT_MS` - optional, defaults to `60000`

FreeMux reads `.env` from the current working directory. Values already present in the shell environment override `.env` values.

## Fallback Policy

FreeMux retries another eligible free model when the upstream failure is likely model/provider-specific:

- `429`
- `404`
- `5xx`
- network failure
- timeout

FreeMux does not blindly retry likely caller/configuration errors:

- invalid local JSON
- missing `messages`
- unknown explicit model id
- OpenRouter auth failure
- ordinary upstream `4xx`

## Streaming

The MVP returns `501` for `stream=true`. Streaming support is a follow-up because mid-stream fallback has different correctness tradeoffs from non-streaming fallback.

## Development Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

The integration tests use a mocked OpenRouter server, so they do not require real credentials.
