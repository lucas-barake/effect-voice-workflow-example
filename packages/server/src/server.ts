import { AppRpc } from "@app/domain/api/app-rpc";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { createServer } from "node:http";
import { AppRpcLive } from "./api/app-rpc-live.js";
import { CallRunManager } from "./api/app-rpc-live/call-run-manager.js";
import { ServicePlatform } from "./api/app-rpc-live/service-platform.js";
import { AppConfig, AppConfigLive } from "./config.js";
import { MigrationLayer } from "./db/migrator.js";
import { PhoneVoiceRoute } from "./http/phone-routes.js";
import { HealthRoute, UploadRoute } from "./http/upload-routes.js";

const RpcApplication = RpcServer.layerHttp({
  group: AppRpc,
  path: "/rpc",
  protocol: "websocket",
}).pipe(
  Layer.provide(AppRpcLive),
  Layer.provide(HttpRouter.layer),
);

const HttpApplication = Layer.mergeAll(
  PhoneVoiceRoute.pipe(Layer.provide(CallRunManager.layer)),
  Layer.mergeAll(HealthRoute, UploadRoute).pipe(Layer.provide(ServicePlatform.layer)),
  RpcApplication,
).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(
    HttpRouter.cors({
      allowedOrigins: ["*"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  ),
);

const ServerLayer = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* AppConfig;
    return HttpRouter.serve(HttpApplication).pipe(
      Layer.provide(
        NodeHttpServer.layer(createServer, { port: config.serverPort }),
      ),
    );
  }),
).pipe(
  Layer.provide(CallRunManager.layer),
  Layer.provide(ServicePlatform.layer),
  Layer.provide(AppConfigLive),
  Layer.provide(MigrationLayer),
  Layer.orDie,
);

NodeRuntime.runMain(Layer.launch(ServerLayer));
