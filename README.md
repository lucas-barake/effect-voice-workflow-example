# Effect Example

This repo is an Effect v4 example monorepo for a voice enabled service workflow. It focuses on:

- conversational appliance triage with `effect/unstable/ai`
- technician matching and booking with PostgreSQL
- Effect RPC over WebSocket for the client to server boundary
- Effect Atom for frontend state
- upload capture flow for visual follow up
- local vision analysis on uploaded appliance photos
- local email outbox for upload invitations
- a Twilio compatible inbound voice webhook that uses the same run manager as the browser console

## Stack

- `packages/domain`
  - shared schemas and RPC contracts
- `packages/server`
  - Effect server, RPC handlers, SQL backed scheduling logic, upload endpoint
- `packages/client`
  - React dashboard, upload page, Effect Atom state, RPC client
- `postgres`
  - technician, specialty, service area, slot, appointment, call session, and upload session data
- `litellm`
  - local OpenAI style gateway that translates app requests into Ollama calls
- `ollama`
  - local model runtime used behind LiteLLM

## What Works

- inbound service session handling through a conversational triage panel
- browser microphone driven spoken turns with assistant playback
- streamed call runs over Effect RPC with tool backed AI turns
- session memory across turns
- technician slot lookup by appliance type and zip code
- appointment booking and confirmation state
- upload link generation and token based upload flow
- local image analysis for appliance recognition and visible issue extraction
- local email delivery records for upload invitation inspection
- Twilio style `POST /api/phone/twilio/voice` support for a real phone number hookup
- Docker Compose startup for Postgres, server, and client, with optional bundled Ollama

## Current Boundaries

- a real carrier account and public phone number still need to be provisioned outside the repo
- the phone path is currently implemented against Twilio style webhooks, not multiple carriers
- speech handling in the browser path still uses browser native microphone capture and speech playback rather than a dedicated backend STT or TTS runtime

Those limits keep the example runnable on local infrastructure without paid AI dependencies.

## Quick Start

1. Copy the defaults if you want a clean local env file.

```bash
cp .env.example .env
```

2. Make sure Ollama is already running on your machine.

```bash
ollama list
```

3. Start the full stack.

```bash
docker compose up --build
```

4. Open the dashboard.

```text
http://localhost:4173
```

5. Use `New call` to start a session, then continue the conversation from the selected call workspace.

The default Compose path reuses your already running host Ollama through LiteLLM.
If you want a fully bundled Ollama inside Compose instead, run:

```bash
LITELLM_OLLAMA_API_BASE=http://ollama:11434 docker compose --profile bundled-ollama up --build
```

After the first build, Docker runs in live development mode. The repo is bind mounted into the
`server` and `client` containers, so backend edits reload through `tsx watch` and frontend edits
reload through Vite without rebuilding the images.

## Local Development Without Docker

You can also run the stack directly on your machine if Postgres and Ollama are already available.

1. Start Postgres and Ollama locally.
2. Pull the model:

```bash
ollama pull llama3.2
ollama pull llama3.2-vision
```

3. Start the server:

```bash
npx pnpm@10.30.3 --filter @app/server dev
```

4. Start the client in another terminal:

```bash
npx pnpm@10.30.3 --filter @app/client exec vite --host 0.0.0.0 --port 4173
```

## Environment

The server reads these variables:

- `DATABASE_URL`
- `PUBLIC_APP_ORIGIN`
- `PUBLIC_WEBHOOK_BASE_URL`
- `SERVER_PORT`
- `LOCAL_LLM_API_URL`
- `LOCAL_LLM_API_KEY`

The client reads:

- `VITE_SERVER_HTTP_ORIGIN`
- `VITE_RPC_WS_URL`

Docker Compose also accepts:

- `LITELLM_OLLAMA_API_BASE`

For a real phone hookup, set `PUBLIC_WEBHOOK_BASE_URL` to the public HTTPS base URL that Twilio will call and point the voice webhook at `/api/phone/twilio/voice`.
The chat and vision model names are fixed in code so the local AI runtime stays predictable.
When you use the default Compose path, `LITELLM_OLLAMA_API_BASE` should normally stay pointed at `http://host.docker.internal:11434` so LiteLLM can reuse your host Ollama.

## Notes

- sample technician data covers 6 technicians and 12 seeded availability slots
- the browser dashboard is the main local console
- the phone webhook shares the same `CallRunManager` and AI toolkit as the browser path
- the upload flow is tokenized, stored locally, and mirrored into the local email outbox
- `npx pnpm@10.30.3 check` passes

## Design Doc

The architecture writeup lives at [docs/technical-design.md](/Users/lucas/src/lucas-barake/household-ops-platform/docs/technical-design.md).
