import { AppConfig } from "@/config.js";
import {
  CallRunInProgress,
  CallRunNotFound,
  CallSessionId,
  SessionNotFound,
} from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as UrlParams from "effect/unstable/http/UrlParams";
import Twilio from "twilio";
import { CallRunManager } from "../api/app-rpc-live/call-run-manager.js";

const parseSessionId = (value: string | null) => {
  if (value === null || value.length === 0) {
    return null;
  }
  try {
    return CallSessionId.make(value);
  } catch {
    return null;
  }
};

const continuePrompt = (assistantMessage: string) =>
  assistantMessage.length === 0
    ? "I am ready for the next detail."
    : `${assistantMessage} You can tell me more, ask for scheduling, or mention an upload.`;

const gatherResponse = (args: {
  readonly actionUrl: string;
  readonly prompt: string;
}) => {
  const response = new Twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["speech"],
    speechTimeout: "auto",
    language: "en-US",
    method: "POST",
    action: args.actionUrl,
  });
  gather.say(args.prompt);
  response.say("I didn't catch that. Please call again if you still need help.");
  return response.toString();
};

const unavailableResponse = {
  status: 503,
  contentType: "text/plain",
  body: "Twilio webhook is not configured.",
} as const;

const invalidSignatureResponse = {
  status: 403,
  contentType: "text/plain",
  body: "Invalid Twilio signature.",
} as const;

const canonicalActionUrl = (
  actionBase: string,
  sessionId: typeof CallSessionId.Type | null,
) => sessionId === null ? actionBase : `${actionBase}?sessionId=${sessionId}`;

const mergeRequestBody = (requestPath: string, body: UrlParams.UrlParams) =>
  body.pipe(
    UrlParams.appendAll(new URL(requestPath, "http://localhost").searchParams),
  );

const parseSessionIdFromRequestPath = (requestPath: string) =>
  parseSessionId(new URL(requestPath, "http://localhost").searchParams.get("sessionId"));

const buildValidationParams = (body: UrlParams.UrlParams) => UrlParams.toRecord(body);

const resolveWebhookUrl = (publicWebhookBaseUrl: string, requestPath: string) => {
  const requestUrl = new URL(requestPath, "http://localhost");
  return new URL(
    `${requestUrl.pathname.replace(/^\/+/, "")}${requestUrl.search}`,
    publicWebhookBaseUrl.endsWith("/") ? publicWebhookBaseUrl : `${publicWebhookBaseUrl}/`,
  ).toString();
};

const runTurn = Effect.fnUntraced(function*(args: {
  readonly actionBase: string;
  readonly body: UrlParams.UrlParams;
  readonly sessionId: typeof CallSessionId.Type | null;
}) {
  const callRunManager = yield* CallRunManager;
  const speechResult = Option.getOrUndefined(UrlParams.getFirst(args.body, "SpeechResult"));
  const from = Option.getOrUndefined(UrlParams.getFirst(args.body, "From"));

  if (typeof speechResult !== "string" || speechResult.trim().length === 0) {
    const prompt = args.sessionId === null
      ? "Thanks for calling household service operations. Please tell me what appliance is giving you trouble."
      : "Tell me the next detail about the appliance issue.";
    return {
      status: 200,
      contentType: "text/xml",
      body: gatherResponse({
        actionUrl: canonicalActionUrl(args.actionBase, args.sessionId),
        prompt,
      }),
    } as const;
  }

  const started = yield* callRunManager.start({
    sessionId: args.sessionId,
    customerName: null,
    phoneNumber: typeof from === "string" ? from : null,
    email: null,
    zipCode: null,
    utterance: speechResult.trim(),
  });

  const assistantMessage = yield* Stream.runFold(
    callRunManager.events(started.runId),
    () => "",
    (current, event) =>
      event._tag === "RunCompleted"
        ? event.assistantMessage
        : event._tag === "Chunk"
        ? `${current}${event.delta}`
        : current,
  );

  return {
    status: 200,
    contentType: "text/xml",
    body: gatherResponse({
      actionUrl: canonicalActionUrl(args.actionBase, started.sessionId),
      prompt: continuePrompt(assistantMessage),
    }),
  } as const;
});

const isTrustedWebhookBaseUrl = (value: string | null): value is string => {
  if (value === null) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export class PhoneVoice extends Context.Service<PhoneVoice, {
  readonly respond: (input: {
    readonly requestPath: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: UrlParams.UrlParams;
  }) => Effect.Effect<{
    readonly status: number;
    readonly contentType: string;
    readonly body: string;
  }, SessionNotFound | CallRunInProgress | CallRunNotFound>;
}>()("PhoneVoice") {
  static layerLocal = Layer.effect(
    this,
    Effect.gen(function*() {
      const callRunManager = yield* CallRunManager;

      return PhoneVoice.of({
        respond: (input) =>
          runTurn({
            actionBase: "/api/phone/twilio/voice",
            body: mergeRequestBody(input.requestPath, input.body),
            sessionId: parseSessionIdFromRequestPath(input.requestPath),
          }).pipe(Effect.provideService(CallRunManager, callRunManager)),
      });
    }),
  );

  static layerTwilio = Layer.effect(
    this,
    Effect.gen(function*() {
      const config = yield* AppConfig;
      const callRunManager = yield* CallRunManager;

      return PhoneVoice.of({
        respond: (input) => {
          const twilioAuthToken = config.twilioAuthToken;
          const publicWebhookBaseUrl = config.publicWebhookBaseUrl;
          if (
            twilioAuthToken === null
            || !isTrustedWebhookBaseUrl(publicWebhookBaseUrl)
          ) {
            return Effect.succeed(unavailableResponse);
          }

          const requestUrl = resolveWebhookUrl(publicWebhookBaseUrl, input.requestPath);
          const actualSignature = input.headers["x-twilio-signature"] ?? "";
          const params = buildValidationParams(input.body);

          if (!Twilio.validateRequest(twilioAuthToken, actualSignature, requestUrl, params)) {
            return Effect.succeed(invalidSignatureResponse);
          }

          return runTurn({
            actionBase: resolveWebhookUrl(publicWebhookBaseUrl, "/api/phone/twilio/voice"),
            body: mergeRequestBody(input.requestPath, input.body),
            sessionId: parseSessionIdFromRequestPath(input.requestPath),
          }).pipe(Effect.provideService(CallRunManager, callRunManager));
        },
      });
    }),
  );

  static layer = Layer.unwrap(
    Effect.gen(function*() {
      const config = yield* AppConfig;
      return config.phoneProvider === "twilio" ? PhoneVoice.layerTwilio : PhoneVoice.layerLocal;
    }),
  );
}
