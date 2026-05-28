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
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as UrlParams from "effect/unstable/http/UrlParams";
import { createHmac } from "node:crypto";
import { CallRunManager } from "../api/app-rpc-live/call-run-manager.js";
import { PhoneVoice } from "./phone-voice.js";

const SESSION_ID = CallSessionId.make("50000000-0000-4000-8000-000000000001");
const RUN_ID = CallRunId.make("50000000-0000-4000-8000-000000000002");

const makeConfigLayer = (
  overrides?: Partial<{
    readonly phoneProvider: "local" | "twilio";
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
    phoneProvider: "local" as const,
    publicAppOrigin: "http://localhost:4173",
    publicWebhookBaseUrl: null,
    twilioAuthToken: null,
    uploadDirectory: "./data/uploads",
    serverPort: 3000,
    localLlmApiUrl: "http://127.0.0.1:11434/v1",
    localLlmApiKey: null,
    ...overrides,
  });

const makePhoneLayer = (overrides?: {
  readonly config?: Partial<{
    readonly phoneProvider: "local" | "twilio";
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
  PhoneVoice.layer.pipe(
    Layer.provide(Layer.succeed(
      CallRunManager,
      CallRunManager.of({
        watch: () => Stream.empty,
        events: overrides?.events ?? (() =>
          Stream.fromIterable([{
            _tag: "RunCompleted" as const,
            sessionId: SESSION_ID,
            assistantMessage: "Check the condenser coils and call back if the problem persists.",
          }])),
        start: overrides?.start ?? (() =>
          Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          })),
        interrupt: () => Effect.void,
      }),
    )),
    Layer.provide(makeConfigLayer(overrides?.config)),
  );

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

const makeParams = (values: Readonly<Record<string, string>>) =>
  UrlParams.fromInput(new URLSearchParams(values));

const makeRepeatedParams = (values: ReadonlyArray<readonly [string, string]>) =>
  UrlParams.fromInput(values);

describe("PhoneVoice", () => {
  it.effect("returns the initial local prompt without Twilio validation", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {},
        body: makeParams({}),
      });

      expect(response.status).toBe(200);
      expect(response.contentType).toBe("text/xml");
      expect(response.body).toContain("Please tell me what appliance is giving you trouble.");
      expect(response.body).toContain("action=\"/api/phone/twilio/voice\"");
    }).pipe(Effect.provide(makePhoneLayer())));

  it.effect("starts a run in local mode and carries the session id forward", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        const response = yield* phoneVoice.respond({
          requestPath: "/api/phone/twilio/voice",
          headers: {},
          body: makeParams({
            SpeechResult: " My refrigerator is warm ",
            From: "+15550199",
          }),
        });

        expect(startCalls).toEqual([{
          sessionId: null,
          customerName: null,
          phoneNumber: "+15550199",
          email: null,
          zipCode: null,
          utterance: "My refrigerator is warm",
        }]);
        expect(response.body).toContain(String(SESSION_ID));
        expect(response.body).toContain("action=\"/api/phone/twilio/voice?sessionId=");
      }).pipe(Effect.provide(makePhoneLayer({
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());

  it.effect("continues an existing session when requestPath includes a valid sessionId and no SpeechResult", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: `/api/phone/twilio/voice?sessionId=${SESSION_ID}`,
        headers: {},
        body: makeParams({}),
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain("Tell me the next detail about the appliance issue.");
      expect(response.body).toContain(`action="/api/phone/twilio/voice?sessionId=${SESSION_ID}"`);
    }).pipe(Effect.provide(makePhoneLayer())));

  it.effect("treats an invalid sessionId in requestPath as a new call", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice?sessionId=not-a-session-id",
        headers: {},
        body: makeParams({}),
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain("Please tell me what appliance is giving you trouble.");
      expect(response.body).toContain("action=\"/api/phone/twilio/voice\"");
      expect(response.body).not.toContain("sessionId=not-a-session-id");
    }).pipe(Effect.provide(makePhoneLayer())));

  it.effect("does not start a run for whitespace only SpeechResult", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        const response = yield* phoneVoice.respond({
          requestPath: "/api/phone/twilio/voice",
          headers: {},
          body: makeParams({
            SpeechResult: "   ",
          }),
        });

        expect(startCalls).toEqual([]);
        expect(response.status).toBe(200);
        expect(response.body).toContain("Please tell me what appliance is giving you trouble.");
      }).pipe(Effect.provide(makePhoneLayer({
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());

  it.effect("starts a run with phoneNumber null when From is absent", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        yield* phoneVoice.respond({
          requestPath: "/api/phone/twilio/voice",
          headers: {},
          body: makeParams({
            SpeechResult: "My refrigerator is warm",
          }),
        });

        expect(startCalls).toEqual([{
          sessionId: null,
          customerName: null,
          phoneNumber: null,
          email: null,
          zipCode: null,
          utterance: "My refrigerator is warm",
        }]);
      }).pipe(Effect.provide(makePhoneLayer({
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());

  it.effect("uses the fallback continuation prompt when the assistant message is empty", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {},
        body: makeParams({
          SpeechResult: "My refrigerator is warm",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain("I am ready for the next detail.");
    }).pipe(Effect.provide(makePhoneLayer({
      events: () =>
        Stream.fromIterable([{
          _tag: "RunCompleted" as const,
          sessionId: SESSION_ID,
          assistantMessage: "",
        }]),
    }))));

  it.effect("keeps local mode when explicitly selected even if Twilio env is present", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {
          "x-twilio-signature": "bad-signature",
        },
        body: makeParams({}),
      });

      expect(response.status).toBe(200);
      expect(response.body).toContain("action=\"/api/phone/twilio/voice\"");
    }).pipe(Effect.provide(makePhoneLayer({
      config: {
        phoneProvider: "local",
        publicWebhookBaseUrl: "https://hooks.example.com",
        twilioAuthToken: "twilio-secret",
      },
    }))));

  it.effect("returns 503 when Twilio mode is selected without trusted Twilio config", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {},
        body: makeParams({ SpeechResult: "My refrigerator is warm" }),
      });

      expect(response.status).toBe(503);
      expect(response.body).toContain("Twilio webhook is not configured");
    }).pipe(Effect.provide(makePhoneLayer({
      config: {
        phoneProvider: "twilio",
      },
    }))));

  it.effect("returns 503 in Twilio mode when PUBLIC_WEBHOOK_BASE_URL is malformed", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {},
        body: makeParams({ SpeechResult: "My refrigerator is warm" }),
      });

      expect(response.status).toBe(503);
      expect(response.body).toContain("Twilio webhook is not configured");
    }).pipe(Effect.provide(makePhoneLayer({
      config: {
        phoneProvider: "twilio",
        publicWebhookBaseUrl: "not a url",
        twilioAuthToken: "twilio-secret",
      },
    }))));

  it.effect("returns 503 in Twilio mode when PUBLIC_WEBHOOK_BASE_URL is not https", () =>
    Effect.gen(function*() {
      const phoneVoice = yield* PhoneVoice;
      const response = yield* phoneVoice.respond({
        requestPath: "/api/phone/twilio/voice",
        headers: {},
        body: makeParams({ SpeechResult: "My refrigerator is warm" }),
      });

      expect(response.status).toBe(503);
      expect(response.body).toContain("Twilio webhook is not configured");
    }).pipe(Effect.provide(makePhoneLayer({
      config: {
        phoneProvider: "twilio",
        publicWebhookBaseUrl: "http://hooks.example.com",
        twilioAuthToken: "twilio-secret",
      },
    }))));

  it.effect("chooses Twilio behavior when Twilio mode is selected and config is complete", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        const response = yield* phoneVoice.respond({
          requestPath: "/api/phone/twilio/voice",
          headers: {
            "x-twilio-signature": "bad-signature",
          },
          body: makeParams({
            SpeechResult: "My refrigerator is warm",
            From: "+15550199",
          }),
        });

        expect(response.status).toBe(403);
        expect(startCalls).toEqual([]);
      }).pipe(Effect.provide(makePhoneLayer({
        config: {
          phoneProvider: "twilio",
          publicWebhookBaseUrl: "https://hooks.example.com",
          twilioAuthToken: "twilio-secret",
        },
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());

  it.effect("merges requestPath query params before running a validated Twilio request", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];
      const params = new URLSearchParams([
        ["SpeechResult", "My refrigerator is warm"],
        ["From", "+15550199"],
      ]);

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        const response = yield* phoneVoice.respond({
          requestPath: `/api/phone/twilio/voice?sessionId=${SESSION_ID}`,
          headers: {
            "x-twilio-signature": computeSignature({
              authToken: "twilio-secret",
              url: `https://hooks.example.com/api/phone/twilio/voice?sessionId=${SESSION_ID}`,
              params,
            }),
          },
          body: UrlParams.fromInput(params),
        });

        expect(response.status).toBe(200);
        expect(startCalls).toEqual([{
          sessionId: SESSION_ID,
          customerName: null,
          phoneNumber: "+15550199",
          email: null,
          zipCode: null,
          utterance: "My refrigerator is warm",
        }]);
      }).pipe(Effect.provide(makePhoneLayer({
        config: {
          phoneProvider: "twilio",
          publicWebhookBaseUrl: "https://hooks.example.com",
          twilioAuthToken: "twilio-secret",
        },
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());

  it.effect("validates Twilio signatures when repeated parameters are present", () =>
    (() => {
      const startCalls: Array<typeof StartCallRunInput.Type> = [];
      const params = new URLSearchParams([
        ["SpeechResult", "My refrigerator is warm"],
        ["From", "+15550199"],
        ["Digits", "1"],
        ["Digits", "2"],
        ["Digits", "3"],
      ]);

      return Effect.gen(function*() {
        const phoneVoice = yield* PhoneVoice;
        const response = yield* phoneVoice.respond({
          requestPath: "/api/phone/twilio/voice",
          headers: {
            "x-twilio-signature": computeSignature({
              authToken: "twilio-secret",
              url: "https://hooks.example.com/api/phone/twilio/voice",
              params,
            }),
          },
          body: makeRepeatedParams([
            ["SpeechResult", "My refrigerator is warm"],
            ["From", "+15550199"],
            ["Digits", "1"],
            ["Digits", "2"],
            ["Digits", "3"],
          ]),
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
      }).pipe(Effect.provide(makePhoneLayer({
        config: {
          phoneProvider: "twilio",
          publicWebhookBaseUrl: "https://hooks.example.com",
          twilioAuthToken: "twilio-secret",
        },
        start: (input) => {
          startCalls.push(input);
          return Effect.succeed({
            runId: RUN_ID,
            sessionId: SESSION_ID,
          });
        },
      })));
    })());
});
