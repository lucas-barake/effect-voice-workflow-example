import { AppConfig } from "@/config.js";
import { CallSessionId } from "@app/domain/service-contract";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as UrlParams from "effect/unstable/http/UrlParams";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CallRunManager } from "../api/app-rpc-live/call-run-manager.js";

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");

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

const gatherResponse = (args: {
  readonly actionUrl: string;
  readonly prompt: string;
}) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" speechTimeout="auto" language="en-US" method="POST" action="${
    escapeXml(args.actionUrl)
  }">
    <Say>${escapeXml(args.prompt)}</Say>
  </Gather>
  <Say>${escapeXml("I didn't catch that. Please call again if you still need help.")}</Say>
</Response>`;

const continuePrompt = (assistantMessage: string) =>
  assistantMessage.length === 0
    ? "I am ready for the next detail."
    : `${assistantMessage} You can tell me more, ask for scheduling, or mention an upload.`;

const computeTwilioSignature = (args: {
  readonly authToken: string;
  readonly url: string;
  readonly params: UrlParams.UrlParams;
}) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of args.params.params) {
    searchParams.append(key, value);
  }
  const payload = [...new Set(searchParams.keys())]
    .sort()
    .flatMap((key) => searchParams.getAll(key).sort().map((value) => `${key}${value}`))
    .join("");
  return createHmac("sha1", args.authToken)
    .update(`${args.url}${payload}`, "utf8")
    .digest("base64");
};

const validateTwilioSignature = (args: {
  readonly authToken: string;
  readonly requestUrl: string;
  readonly params: UrlParams.UrlParams;
  readonly actualSignature: string | undefined;
}) => {
  if (typeof args.actualSignature !== "string" || args.actualSignature.length === 0) {
    return false;
  }
  const expectedSignature = computeTwilioSignature({
    authToken: args.authToken,
    url: args.requestUrl,
    params: args.params,
  });
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(args.actualSignature);
  return expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const PhoneVoiceRoute = HttpRouter.add(
  "POST",
  "/api/phone/twilio/voice",
  Effect.gen(function*() {
    const config = yield* AppConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const callRunManager = yield* CallRunManager;

    const body = yield* request.urlParamsBody;
    const requestUrl = new URL(request.url, config.publicWebhookBaseUrl ?? "http://localhost:3000");
    const sessionId = parseSessionId(requestUrl.searchParams.get("sessionId"));
    const speechResult = Option.getOrUndefined(UrlParams.getFirst(body, "SpeechResult"));
    const from = Option.getOrUndefined(UrlParams.getFirst(body, "From"));

    if (config.publicWebhookBaseUrl !== null && config.twilioAuthToken === null) {
      return HttpServerResponse.text("Twilio webhook is not configured.", { status: 503 });
    }
    if (
      config.twilioAuthToken !== null
      && !validateTwilioSignature({
        authToken: config.twilioAuthToken,
        requestUrl: requestUrl.toString(),
        params: body,
        actualSignature: request.headers["x-twilio-signature"],
      })
    ) {
      return HttpServerResponse.text("Invalid Twilio signature.", { status: 403 });
    }

    const actionBase = config.publicWebhookBaseUrl === null
      ? "/api/phone/twilio/voice"
      : `${config.publicWebhookBaseUrl}/api/phone/twilio/voice`;

    if (typeof speechResult !== "string" || speechResult.trim().length === 0) {
      const prompt = sessionId === null
        ? "Thanks for calling household service operations. Please tell me what appliance is giving you trouble."
        : "Tell me the next detail about the appliance issue.";
      return HttpServerResponse.text(
        gatherResponse({
          actionUrl: sessionId === null ? actionBase : `${actionBase}?sessionId=${sessionId}`,
          prompt,
        }),
        { contentType: "text/xml" },
      );
    }

    const started = yield* callRunManager.start({
      sessionId,
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

    return HttpServerResponse.text(
      gatherResponse({
        actionUrl: `${actionBase}?sessionId=${started.sessionId}`,
        prompt: continuePrompt(assistantMessage),
      }),
      { contentType: "text/xml" },
    );
  }),
);

export const PhoneRoutes = Layer.mergeAll(PhoneVoiceRoute).pipe(
  Layer.provide(CallRunManager.layer),
);
