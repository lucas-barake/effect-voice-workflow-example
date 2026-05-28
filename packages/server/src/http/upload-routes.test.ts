import { UploadToken } from "@app/domain/service-contract";
import { NodeHttpServer } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { ServicePlatform } from "../api/app-rpc-live/service-platform.js";
import { HealthRoute, UploadRoute } from "./upload-routes.js";

const TOKEN = UploadToken.make("upload-token-1234567890");

const makeUploadRoutesLayer = (storeUpload?: ReturnType<typeof vi.fn>) =>
  HttpRouter.serve(Layer.mergeAll(HealthRoute, UploadRoute)).pipe(
    Layer.provide(
      Layer.succeed(
        ServicePlatform,
        ServicePlatform.of({
          getDashboardSnapshot: Effect.die("unused"),
          getCallSession: () => Effect.die("unused"),
          bookAppointment: () => Effect.die("unused"),
          createUploadLink: () => Effect.die("unused"),
          getUploadSession: () => Effect.die("unused"),
          storeUpload: storeUpload ?? vi.fn((token, file) =>
            Effect.succeed({
              token,
              status: "analyzed" as const,
              email: "pat@example.com",
              uploadUrl: `http://localhost:4173/upload/${token}`,
              uploadedAt: "2026-05-27T12:00:00.000Z",
              analysisSummary: `${file.name} uploaded`,
              recognizedApplianceType: "refrigerator" as const,
              visibleSignals: [],
              expiresAt: "2026-05-28T12:00:00.000Z",
            })
          ),
        }),
      ),
    ),
  );

describe("UploadRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.effect("returns a health payload", () =>
    Effect.gen(function*() {
      yield* Layer.build(makeUploadRoutesLayer());

      const response = yield* HttpClient.get("/health");

      expect(response.status).toBe(200);
      expect(yield* response.json).toEqual({ ok: true });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));

  it.effect("rejects upload requests without a file", () =>
    Effect.gen(function*() {
      yield* Layer.build(makeUploadRoutesLayer());

      const response = yield* HttpClient.post(`/api/uploads/${TOKEN}`, {
        body: HttpBody.formData(new FormData()),
      });

      expect(response.status).toBe(400);
      expect(yield* response.json).toEqual({ error: "Expected a file field named file." });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));

  it.effect("passes the uploaded file to the service platform", () =>
    Effect.gen(function*() {
      const storeUpload = vi.fn((token, file) =>
        Effect.succeed({
          token,
          status: "analyzed" as const,
          email: "pat@example.com",
          uploadUrl: `http://localhost:4173/upload/${token}`,
          uploadedAt: "2026-05-27T12:00:00.000Z",
          analysisSummary: `${file.name} uploaded`,
          recognizedApplianceType: "refrigerator" as const,
          visibleSignals: [],
          expiresAt: "2026-05-28T12:00:00.000Z",
        })
      );
      yield* Layer.build(makeUploadRoutesLayer(storeUpload));

      const formData = new FormData();
      formData.append("file", new Blob(["image"], { type: "image/jpeg" }), "fridge.jpg");

      const response = yield* HttpClient.post(`/api/uploads/${TOKEN}`, {
        body: HttpBody.formData(formData),
      });

      expect(response.status).toBe(200);
      expect(storeUpload).toHaveBeenCalledTimes(1);
      expect(storeUpload.mock.calls[0]?.[0]).toBe(TOKEN);
      expect(storeUpload.mock.calls[0]?.[1].name).toBe("fridge.jpg");
      expect(typeof storeUpload.mock.calls[0]?.[1].path).toBe("string");
      expect(yield* response.json).toEqual({
        token: TOKEN,
        status: "analyzed",
        email: "pat@example.com",
        uploadUrl: `http://localhost:4173/upload/${TOKEN}`,
        uploadedAt: "2026-05-27T12:00:00.000Z",
        analysisSummary: "fridge.jpg uploaded",
        recognizedApplianceType: "refrigerator",
        visibleSignals: [],
        expiresAt: "2026-05-28T12:00:00.000Z",
      });
    }).pipe(Effect.provide(NodeHttpServer.layerTest)));
});
