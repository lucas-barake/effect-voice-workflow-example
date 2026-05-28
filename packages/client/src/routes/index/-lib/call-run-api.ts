import { DomainRpcClient } from "@/services/rpc-client.js";
import type { CallRunId, CallSessionId, StartCallRunInput } from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class CallRunApi extends Context.Service<CallRunApi>()("@app/dashboard/CallRunApi", {
  make: Effect.gen(function*() {
    const rpc = yield* DomainRpcClient;
    return {
      startCallRun: (input: StartCallRunInput) => rpc.StartCallRun(input),
      callRunEvents: (runId: CallRunId) => rpc.CallRunEvents({ runId }),
      callRunWatch: (sessionId: CallSessionId) => rpc.CallRunWatch({ sessionId }),
      interruptCallRun: (sessionId: CallSessionId) => rpc.InterruptCallRun({ sessionId }),
    };
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DomainRpcClient.layer),
  );
}
