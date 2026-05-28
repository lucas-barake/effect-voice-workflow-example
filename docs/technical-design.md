# Technical Design

## Goal

The system handles a home appliance support conversation, keeps track of what the caller has already said, offers troubleshooting, and schedules a technician when self service is no longer the best option. The main goal is not just model output. It is a reliable operational workflow with typed boundaries, durable state, and a local runtime.

## Architecture

The monorepo is split into domain, server, and client packages.

- `packages/domain` owns the source of truth for schemas, branded identifiers, errors, and RPC contracts.
- `packages/server` owns database access, session orchestration, uploads, and the Effect AI integration.
- `packages/client` owns the operations dashboard and upload UX using Effect Atom.

The client talks to the server through Effect RPC over WebSocket. That choice keeps the transport strongly typed without hand written DTO drift and makes the dashboard code feel close to a local service boundary. The same contract powers read models, streamed call runs, and client side refresh behavior.

## Why Effect v4

Effect v4 is a strong fit because the project has three concerns that benefit from explicit effects and layers:

1. infrastructure dependencies such as Postgres, HTTP, and the local model endpoint
2. a typed conversational boundary where model outputs should decode into application data
3. a frontend state model where remote queries and mutations should remain coherent after writes

`effect/unstable/ai` is used for both streamed assistant turns and structured session updates. The application does not parse arbitrary free form planner output. Instead it streams the caller facing response, lets the model use a typed toolkit for live operational lookups, and then asks for a typed session state update that fits the service workflow. `@effect/ai-openai-compat` lets the project point that abstraction at a free local Ollama endpoint rather than a paid hosted model.

`effect/unstable/rpc` carries the server contract. `effect/unstable/reactivity` plus `@effect/atom-react` powers the dashboard state and keeps query invalidation colocated with mutations.

## Data Model

The database is intentionally narrow:

- technicians
- technician specialties
- technician service zip codes
- availability slots
- call sessions
- appointments
- upload sessions
- email deliveries

This shape mirrors the project scope directly. It is enough to demonstrate realistic slot matching and booking behavior without introducing production scale complexity that the example does not need.

## Triage Flow

Both the browser console and the phone webhook drive the same workflow run stack:

1. caller speech or typed text starts a `CallRun`
2. server reserves the session through a workflow run coordinator
3. the model streams assistant text and can call a typed toolkit for recommended slots, technician load, upload context, and appointment booking
4. server persists the authoritative session update after the turn completes
5. browser clients refresh from `watch` plus `events`, while the phone webhook waits for completion and speaks the reply back to the caller

The important design choice is that the model does not mutate the database arbitrarily. It can only schedule by calling a typed booking tool that routes into deterministic application logic against the database.

## Scheduling Flow

Slot lookup is keyed by appliance type and zip code. The agent is prompted to collect caller availability first, propose one or two matching windows, and only book after the caller accepts a specific slot. Booking is transactional. A slot is only assigned when it is still open at write time, and the session is updated to `scheduled` in the same database transaction.

This keeps the model out of critical booking decisions and ensures the behavior stays explainable.

## Upload Flow

The upload system creates a unique token, persists an upload session, records a local email delivery entry, stores the image locally, and then runs a second structured `generateObject` pass against a local vision model through the same OpenAI compatible Effect adapter. The result updates the session with a recognized appliance type, a compact analysis summary, and extracted visible signals.

## Tradeoffs

- I kept the browser console because it is the fastest local console and does not depend on a provisioned carrier account.
- I added a Twilio compatible phone webhook because the phone boundary is useful to demonstrate, but the repo cannot itself provision or fund a public number.
- I kept browser native speech recognition and playback for the browser path because it gives a zero cost local loop while the phone path relies on Twilio speech capture and `Say`.
- I chose a local Ollama path over hosted APIs to keep the core system runnable without paid model credentials.
- I kept the operational model narrow and typed instead of building a broad autonomous agent. The example favors working workflow design more than maximal agent complexity.

## Next Steps

The cleanest extensions from here are:

- add Whisper based speech to text and an OSS text to speech engine behind Effect services
- add alternate carrier adapters such as Telnyx or Vonage behind the same phone route service boundary
