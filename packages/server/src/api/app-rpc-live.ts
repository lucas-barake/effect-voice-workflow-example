import { AppRpc } from "@app/domain/api/app-rpc";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CallRunManager } from "./app-rpc-live/call-run-manager.js";
import { ServicePlatform } from "./app-rpc-live/service-platform.js";

export const AppRpcLive = AppRpc.toLayer(
  Effect.gen(function*() {
    const servicePlatform = yield* ServicePlatform;
    const callRunManager = yield* CallRunManager;
    return AppRpc.of({
      GetDashboardSnapshot: () => servicePlatform.getDashboardSnapshot,
      GetCallSession: Effect.fnUntraced(function*(payload) {
        return yield* servicePlatform.getCallSession(payload.sessionId);
      }),
      StartCallRun: Effect.fnUntraced(function*(payload) {
        return yield* callRunManager.start(payload);
      }),
      CallRunEvents: (payload) => callRunManager.events(payload.runId),
      CallRunWatch: (payload) => callRunManager.watch(payload.sessionId),
      InterruptCallRun: Effect.fnUntraced(function*(payload) {
        return yield* callRunManager.interrupt(payload.sessionId);
      }),
      BookAppointment: Effect.fnUntraced(function*(payload) {
        return yield* servicePlatform.bookAppointment(payload);
      }),
      CreateUploadLink: Effect.fnUntraced(function*(payload) {
        return yield* servicePlatform.createUploadLink(payload.sessionId, payload.email);
      }),
      GetUploadSession: Effect.fnUntraced(function*(payload) {
        return yield* servicePlatform.getUploadSession(payload.token);
      }),
    });
  }),
).pipe(
  Layer.provide(CallRunManager.layer),
  Layer.provide(ServicePlatform.layer),
);
