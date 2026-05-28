import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { PhoneVoice } from "./phone-voice.js";

export const PhoneVoiceRoute = HttpRouter.add(
  "POST",
  "/api/phone/twilio/voice",
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.urlParamsBody;
    const phoneVoice = yield* PhoneVoice;
    const response = yield* phoneVoice.respond({
      requestPath: request.url,
      headers: request.headers,
      body,
    });

    return HttpServerResponse.text(response.body, {
      status: response.status,
      contentType: response.contentType,
    });
  }),
);

export const PhoneVoiceRouteLive = PhoneVoiceRoute.pipe(
  HttpRouter.provideRequest(PhoneVoice.layer),
);
