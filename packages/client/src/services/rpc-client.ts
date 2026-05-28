import { AppRpc } from "@app/domain/api/app-rpc";
import * as BrowserSocket from "@effect/platform-browser/BrowserSocket";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";

export const rpcWebSocketUrl = import.meta.env.VITE_RPC_WS_URL ?? "ws://localhost:3000/rpc";
export const serverHttpOrigin = import.meta.env.VITE_SERVER_HTTP_ORIGIN ?? "http://localhost:3000";

const protocol = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(
    Layer.mergeAll(
      BrowserSocket.layerWebSocket(rpcWebSocketUrl),
      RpcSerialization.layerJson,
    ),
  ),
);

export class ServiceOpsClient extends AtomRpc.Service()("ServiceOpsClient", {
  group: AppRpc,
  protocol,
}) {}

export class DomainRpcClient extends Context.Service<
  DomainRpcClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof AppRpc>, RpcClientError.RpcClientError>
>()("DomainRpcClient") {
  static layer = Layer.effect(DomainRpcClient)(
    RpcClient.make(AppRpc),
  ).pipe(
    Layer.provide(
      RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
        Layer.provide([
          BrowserSocket.layerWebSocket(rpcWebSocketUrl),
          RpcSerialization.layerJson,
        ]),
      ),
    ),
  );
}
