import { AppConfig } from "@/config.js";
import {
  CallRunEvent,
  CallRunId,
  CallRunInProgress,
  CallRunNotFound,
  CallSessionId,
  SessionNotFound,
  StartCallRunInput,
} from "@app/domain/service-contract";
import { NodeHttpServer } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import { createHmac } from "node:crypto";
import { CallRunManager } from "../api/app-rpc-live/call-run-manager.js";
import { PhoneVoiceRoute } from "./phone-routes.js";

const SESSION_ID = CallSessionId.make("40000000-0000-4000-8000-000000000001");
const RUN_ID = CallRunId.make("40000000-0000-4000-8000-000000000002");

const makeConfigLayer = (
  overrides?: Partial<{
    readonly publicAppOrigin: string;
    readonly publicWebhookBaseUrl: string | null;
    readonly twilioAuthToken: string | null;
    readonly uploadDirectory: string;
    readonly serverPort: number;
    readonly localLlmApiUrl: string;
    readonly localLlmApiKey: string | null;
  }>,
) =>
  Layer.succeed(AppConfig, {
    publicAppOrigin: "http://localhost:4173",
    publicWebhookBaseUrl: null,
    twilioAuthToken: null,
    uploadDirectory: "./data/uploads",
    serverPort: 3000,
    localLlmApiUrl: "http://127.0.0.1:11434/v1",
    localLlmApiKey: null,
    ...overrides,
  });

const computeSignature = (args: {
  readonly authToken: string;
  readonly url: string;
  readonly params: URLSearchParams;
}) =>
  createHmac(
    "sha1",
    args.authToken,
  )
    .update(
      `${args.url}${
        [...new Set(args.params.keys())]
          .sort()
          .flatMap((key) => args.params.getAll(key).sort().map((value) => `${key}${value}`))
          .join("")
      }`,
      "utf8",
    )
    .digest("base64");

const makeRouteLayer = (overrides?: {
  readonly config?: Partial<{
    readonly publicAppOrigin: string;
    readonly publicWebhookBaseUrl: string | null;
    readonly twilioAuthToken: string | null;
    readonly uploadDirectory: string;
    readonly serverPort: number;
    readonly localLlmApiUrl: string;
    readonly localLlmApiKey: string | null;
  }>;
  readonly start?: (
    input: typeof StartCallRunInput.Type,
  ) => Effect.Effect<
    { readonly runId: typeof CallRunId.Type; readonly sessionId: typeof CallSessionId.Type; },
    SessionNotFound | CallRunInProgress
  >;
  readonly events?: (
    runId: typeof CallRunId.Type,
  ) => Stream.Stream<typeof CallRunEvent.Type, CallRunNotFound>;
}) =>
  HttpRouter.serve(PhoneVoiceRoute).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          CallRunManager,
          CallRunManager.of({
            watch: () => Stream.empty,
            events: overrides?.events ?? (() =>
              Stream.fromIterable([{
                _tag: "RunCompleted" as const,
                sessionId: SESSION_ID,
                assistantMessage: "Check the condenser coils and tell me if they are dusty.",
              }])),
            start: overrides?.start ?? (() =>
              Effect.succeed({
                runId: RUN_ID,
                sessionId: SESSION_ID,
              })),
            interrupt: () => Effect.void,
          }),
        ),
        makeConfigLayer(overrides?.config),
      ),
    ),
  );

describe("PhoneVoiceRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const postVoiceRequest = (args: {
    readonly body: URLSearchParams;
    readonly headers?: HeadersInit;
  }) =>
    Effect.gen(function*() {
      const server = yield* HttpServer.HttpServer;
      const address = server.address;
      const baseUrl = address._tag === "TcpAddress"
        ? `http://${
          address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname
        }:${address.port}`
        : "http://127.0.0.1";
      return yield* Effect.tryPromise({
        try: () =>
          fetch(`${baseUrl}/api/phone/twilio/voice`, {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              ...args.headers,
            },
            body: args.body.toString(),
          }),
        catch: Effect.die,
      });
    });

  it.effect("rejects public webhook requests when the Twilio auth token is missing", () =>
    Effect.gen(function*() {
      yield* Layer.build(makeRouteLayer({
        config: { publicWebhookBaseUrl: "http://localhost:3000" },
      }));

      const response = yield* postVoiceRequest({
        body: new URLSearchParams({ SpeechResult: "My refrigerator is warm" }),
      });

      expect(response.status).toBe(503);
      expect(yield* Effect.promise(() => response.text())).toContain("not configured");
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));

  it.effect("rejects invalid Twilio signatures", () =>
    Effect.gen(function*() {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];
      yield* Layer.build(makeRouteLayer({
        config: {
          publicWebhookBaseUrl: "http://localhost:3000",
          twilioAuthToken: "twilio-secret",
        },
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      }));

      const response = yield* postVoiceRequest({
        body: new URLSearchParams({
          SpeechResult: "My refrigerator is warm",
          From: "+15550199",
        }),
        headers: {
          "x-twilio-signature": "bad-signature",
        },
      });

      expect(response.status).toBe(403);
      expect(startCalls).toEqual([]);
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));

  it.effect("starts a run and returns TwiML when the signature is valid", () =>
    Effect.gen(function*() {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];
      const eventRunIds: Array<typeof CallRunId.Type> = [];
      yield* Layer.build(makeRouteLayer({
        config: {
          publicWebhookBaseUrl: "http://localhost:3000",
          twilioAuthToken: "twilio-secret",
        },
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
        events: (runId) => {
          eventRunIds.push(runId);
          return Stream.fromIterable([
            { _tag: "Chunk" as const, delta: "Check the condenser coils. " },
            {
              _tag: "RunCompleted" as const,
              sessionId: SESSION_ID,
              assistantMessage: "Check the condenser coils and call back if the problem persists.",
            },
          ]);
        },
      }));

      const params = new URLSearchParams({
        SpeechResult: "My refrigerator is warm",
        From: "+15550199",
      });
      const response = yield* postVoiceRequest({
        body: params,
        headers: {
          "x-twilio-signature": computeSignature({
            authToken: "twilio-secret",
            url: "http://localhost:3000/api/phone/twilio/voice",
            params,
          }),
        },
      });

      expect(response.status).toBe(200);
      expect(startCalls).toEqual([{
        sessionId: null,
        customerName: null,
        phoneNumber: "+15550199",
        email: null,
        zipCode: null,
        utterance: "My refrigerator is warm",
      }]);
      expect(eventRunIds).toEqual([RUN_ID]);
      expect(yield* Effect.promise(() => response.text())).toContain(String(SESSION_ID));
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));
});
