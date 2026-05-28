import { UploadToken } from "@app/domain/service-contract";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { ServicePlatform } from "../api/app-rpc-live/service-platform.js";

const UploadPathParams = Schema.Struct({
  token: UploadToken,
}).annotate({ identifier: "UploadPathParams" });

export const HealthRoute = HttpRouter.add(
  "GET",
  "/health",
  HttpServerResponse.json({ ok: true }),
);

export const UploadRoute = HttpRouter.add(
  "POST",
  "/api/uploads/:token",
  Effect.gen(function*() {
    const { token } = yield* HttpRouter.schemaPathParams(UploadPathParams);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const servicePlatform = yield* ServicePlatform;
    const multipart = yield* request.multipart;
    const part = multipart.file;

    if (part === undefined || typeof part === "string" || part.length === 0) {
      return yield* HttpServerResponse.json(
        { error: "Expected a file field named file." },
        { status: 400 },
      );
    }

    const filePart = part[0];
    if (filePart === undefined || typeof filePart === "string") {
      return yield* HttpServerResponse.json(
        { error: "Expected an uploaded file." },
        { status: 400 },
      );
    }

    const uploadSession = yield* servicePlatform.storeUpload(token, {
      path: filePart.path,
      name: filePart.name,
    });
    return yield* HttpServerResponse.json(uploadSession);
  }),
);

export const UploadRoutes = Layer.mergeAll(HealthRoute, UploadRoute).pipe(
  Layer.provide(ServicePlatform.layer),
);
