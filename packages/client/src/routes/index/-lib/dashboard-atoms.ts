import { DomainRpcClient } from "@/services/rpc-client.js";
import type {
  BookAppointmentInput,
  CallRunEvent,
  CallRunId,
  CallRunWatchEvent,
  CallSessionId,
  CreateUploadLinkInput,
  StartCallRunInput,
  TranscriptEntry,
  UploadToken,
} from "@app/domain/service-contract";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

export class DashboardApi extends Context.Service<DashboardApi>()("@app/dashboard/DashboardApi", {
  make: Effect.gen(function*() {
    const rpc = yield* DomainRpcClient;

    return {
      getDashboardSnapshot: () => rpc.GetDashboardSnapshot(undefined),
      getCallSession: (sessionId: CallSessionId) => rpc.GetCallSession({ sessionId }),
      getUploadSession: (token: UploadToken) => rpc.GetUploadSession({ token }),
      bookAppointment: (payload: BookAppointmentInput) => rpc.BookAppointment(payload),
      createUploadLink: (payload: CreateUploadLinkInput) => rpc.CreateUploadLink(payload),
      startCallRun: (payload: StartCallRunInput) => rpc.StartCallRun(payload),
      callRunEvents: (runId: CallRunId) => rpc.CallRunEvents({ runId }),
      callRunWatch: (sessionId: CallSessionId) => rpc.CallRunWatch({ sessionId }),
      interruptCallRun: (sessionId: CallSessionId) => rpc.InterruptCallRun({ sessionId }),
    } as const;
  }),
}) {
  static layer = Layer.effect(this, this.make).pipe(Layer.provide(DomainRpcClient.layer));
}

export const dashboardRuntime = Atom.runtime(DashboardApi.layer);

type LocalRunState =
  | { readonly _tag: "Idle"; }
  | {
    readonly _tag: "Streaming";
    readonly runId: CallRunId;
    readonly assistantMessage: string;
    readonly events: ReadonlyArray<CallRunEvent>;
  }
  | {
    readonly _tag: "Completed";
    readonly runId: CallRunId;
    readonly assistantMessage: string;
    readonly events: ReadonlyArray<CallRunEvent>;
  }
  | {
    readonly _tag: "Interrupted";
    readonly runId: CallRunId;
    readonly assistantMessage: string;
    readonly events: ReadonlyArray<CallRunEvent>;
  }
  | {
    readonly _tag: "Failed";
    readonly runId: CallRunId;
    readonly assistantMessage: string;
    readonly events: ReadonlyArray<CallRunEvent>;
    readonly cause: Cause.Cause<unknown>;
  };

const idleRunState: LocalRunState = { _tag: "Idle" };

const emptyRunAccumulator = {
  assistantMessage: "",
  events: [] as ReadonlyArray<CallRunEvent>,
};

const reduceRunAccumulator = (
  current: typeof emptyRunAccumulator,
  event: CallRunEvent,
) => {
  switch (event._tag) {
    case "Chunk":
      return {
        assistantMessage: `${current.assistantMessage}${event.delta}`,
        events: [...current.events, event],
      };
    case "RunCompleted":
      return {
        assistantMessage: event.assistantMessage,
        events: [...current.events, event],
      };
    case "ReasoningChunk":
    case "ToolFailure":
    case "ToolStart":
    case "ToolSuccess":
      return {
        assistantMessage: current.assistantMessage,
        events: [...current.events, event],
      };
  }
};

const readRunAccumulator = (
  result: AsyncResult.AsyncResult<typeof emptyRunAccumulator, unknown>,
) =>
  AsyncResult.isSuccess(result)
    ? result.value
    : AsyncResult.isFailure(result) && result.previousSuccess._tag === "Some"
    ? result.previousSuccess.value.value
    : emptyRunAccumulator;

const refreshDashboardAndSession = Effect.fnUntraced(function*({
  get,
  sessionId,
}: {
  readonly get: Atom.FnContext;
  readonly sessionId: CallSessionId;
}) {
  get.refresh(dashboardSnapshotAtom);
  get.refresh(selectedSessionAtom(sessionId));
  yield* get.result(selectedSessionAtom(sessionId), { suspendOnWaiting: true });
});

export const dashboardSnapshotAtom = dashboardRuntime.atom(
  Effect.gen(function*() {
    const api = yield* DashboardApi;
    return yield* api.getDashboardSnapshot();
  }),
);

export const activeSessionIdAtom = Atom.make<CallSessionId | null>(null);
export const createCallPanelOpenAtom = Atom.make(false);
export const voiceModeAtom = Atom.make<"manual" | "browser-voice">("manual");
export const autoSpeakAssistantAtom = Atom.make(true);

export const simulatorFormAtom = Atom.make({
  customerName: "Pat Jordan",
  phoneNumber: "+1-555-0199",
  email: "pat@example.com",
  zipCode: "60601",
  utterance: "My refrigerator is warm and making a buzzing noise.",
});

export const selectedSessionAtom = Atom.family((sessionId: CallSessionId) =>
  dashboardRuntime.atom(
    Effect.gen(function*() {
      const api = yield* DashboardApi;
      return yield* api.getCallSession(sessionId);
    }),
  )
);

export const uploadSessionAtom = Atom.family((token: UploadToken) =>
  dashboardRuntime.atom(
    Effect.gen(function*() {
      const api = yield* DashboardApi;
      return yield* api.getUploadSession(token);
    }),
  )
);

const pendingCallTurnFamily = Atom.family((_sessionId: CallSessionId) =>
  Atom.make<
    {
      readonly runId: CallRunId;
      readonly callerMessage: string;
      readonly at: string;
    } | null
  >(null)
);

const callRunWatchStateFamily = Atom.family((sessionId: CallSessionId) =>
  dashboardRuntime.atom((get) =>
    Stream.unwrap(
      Effect.gen(function*() {
        const api = yield* DashboardApi;

        return api.callRunWatch(sessionId).pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              get.refresh(dashboardSnapshotAtom);
              get.refresh(selectedSessionAtom(sessionId));
            })
          ),
          Stream.scan(
            { currentRunId: null as CallRunId | null, lastRunId: null as CallRunId | null },
            (state, event: CallRunWatchEvent) => ({
              currentRunId: event.runId,
              lastRunId: event.runId ?? state.lastRunId,
            }),
          ),
        );
      }),
    ), {
    initialValue: { currentRunId: null as CallRunId | null, lastRunId: null as CallRunId | null },
  }).pipe(Atom.setIdleTTL("1 minute"))
);

const callRunEventsFamily = Atom.family((runId: CallRunId) =>
  dashboardRuntime.atom(
    Stream.unwrap(
      Effect.gen(function*() {
        const api = yield* DashboardApi;
        return api.callRunEvents(runId).pipe(
          Stream.scan(emptyRunAccumulator, reduceRunAccumulator),
        );
      }),
    ),
    { initialValue: emptyRunAccumulator },
  ).pipe(Atom.setIdleTTL("1 minute"))
);

export const watchCallSessionFamily = callRunWatchStateFamily;

export const sessionTranscriptAtom = Atom.family((sessionId: CallSessionId) =>
  Atom.make((get): ReadonlyArray<TranscriptEntry> => {
    const sessionResult = get(selectedSessionAtom(sessionId));

    if (!AsyncResult.isSuccess(sessionResult)) {
      return [];
    }

    const transcript = [...sessionResult.value.transcript];
    const pendingCallTurn = get(pendingCallTurnFamily(sessionId));
    const liveCallRun = get(callRunStateFamily(sessionId));

    if (
      pendingCallTurn !== null
      && !transcript.some((entry) =>
        entry.role === "caller" && entry.message === pendingCallTurn.callerMessage
      )
    ) {
      transcript.push({
        role: "caller",
        message: pendingCallTurn.callerMessage,
        at: pendingCallTurn.at,
      });
    }

    if (
      liveCallRun._tag === "Idle"
      || pendingCallTurn === null
      || liveCallRun.runId !== pendingCallTurn.runId
    ) {
      return transcript;
    }

    const assistantMessage = liveCallRun.assistantMessage.length === 0
      ? liveCallRun._tag === "Streaming"
        ? "Agent is replying."
        : ""
      : liveCallRun.assistantMessage;

    if (
      assistantMessage.length === 0
      || transcript.some((entry) =>
        entry.role === "assistant" && entry.message === assistantMessage
      )
    ) {
      return transcript;
    }

    transcript.push({
      role: "assistant",
      message: assistantMessage,
      at: pendingCallTurn.at,
    });

    return transcript;
  })
);

export const callRunStateFamily = Atom.family((sessionId: CallSessionId) =>
  Atom.make((get): LocalRunState => {
    const sessionResult = get(selectedSessionAtom(sessionId));
    const watchResult = get(watchCallSessionFamily(sessionId));
    const startResult = get(startCallRunAtom);

    const currentWatchedRunId = AsyncResult.isSuccess(watchResult)
      ? watchResult.value.currentRunId
      : null;
    const sessionRunId = AsyncResult.isSuccess(sessionResult)
      ? sessionResult.value.activeRunId
      : null;
    const lastWatchedRunId = AsyncResult.isSuccess(watchResult)
      ? watchResult.value.lastRunId
      : null;
    const startedRunId = startResult !== undefined
        && AsyncResult.isSuccess(startResult)
        && startResult.value !== undefined
        && startResult.value.sessionId === sessionId
      ? startResult.value.runId
      : null;
    const runId = currentWatchedRunId ?? sessionRunId ?? lastWatchedRunId ?? startedRunId;

    if (runId === null) {
      return idleRunState;
    }

    const streamResult = get(callRunEventsFamily(runId));
    const snapshot = readRunAccumulator(streamResult);

    if (AsyncResult.isFailure(streamResult)) {
      return Cause.hasInterruptsOnly(streamResult.cause)
        ? {
          _tag: "Interrupted",
          runId,
          assistantMessage: snapshot.assistantMessage,
          events: snapshot.events,
        }
        : {
          _tag: "Failed",
          runId,
          assistantMessage: snapshot.assistantMessage,
          events: snapshot.events,
          cause: streamResult.cause,
        };
    }

    if (streamResult.waiting) {
      return {
        _tag: "Streaming",
        runId,
        assistantMessage: snapshot.assistantMessage,
        events: snapshot.events,
      };
    }

    return {
      _tag: "Completed",
      runId,
      assistantMessage: snapshot.assistantMessage,
      events: snapshot.events,
    };
  })
);

export const activeSessionResultAtom = Atom.make((get) => {
  const activeSessionId = get(activeSessionIdAtom);
  return activeSessionId === null ? null : get(selectedSessionAtom(activeSessionId));
});

export const activeCallRunStateAtom = Atom.make((get) => {
  const activeSessionId = get(activeSessionIdAtom);
  return activeSessionId === null ? idleRunState : get(callRunStateFamily(activeSessionId));
});

export const bookAppointmentMutationAtom = dashboardRuntime.fn<BookAppointmentInput>()(
  Effect.fnUntraced(function*(payload, get) {
    const api = yield* DashboardApi;
    const result = yield* api.bookAppointment(payload);
    yield* refreshDashboardAndSession({ get, sessionId: payload.sessionId });
    return result;
  }),
);

export const createUploadLinkMutationAtom = dashboardRuntime.fn<CreateUploadLinkInput>()(
  Effect.fnUntraced(function*(payload, get) {
    const api = yield* DashboardApi;
    const result = yield* api.createUploadLink(payload);
    yield* refreshDashboardAndSession({ get, sessionId: payload.sessionId });
    return result;
  }),
);

export const startCallRunAtom = dashboardRuntime.fn<StartCallRunInput>()(
  Effect.fnUntraced(function*(payload, get) {
    const api = yield* DashboardApi;
    const result = yield* api.startCallRun(payload);
    get.set(activeSessionIdAtom, result.sessionId);
    get.set(createCallPanelOpenAtom, false);
    get.set(pendingCallTurnFamily(result.sessionId), {
      runId: result.runId,
      callerMessage: payload.utterance,
      at: DateTime.formatIso(DateTime.nowUnsafe()),
    });
    get.refresh(dashboardSnapshotAtom);
    get.refresh(selectedSessionAtom(result.sessionId));
    return result;
  }),
  { concurrent: true },
);

export const interruptCallRunAtom = dashboardRuntime.fn<{ readonly sessionId: CallSessionId; }>()(
  Effect.fnUntraced(function*({ sessionId }, get) {
    const api = yield* DashboardApi;
    yield* api.interruptCallRun(sessionId);
    get.set(pendingCallTurnFamily(sessionId), null);
    yield* refreshDashboardAndSession({ get, sessionId }).pipe(Effect.ignore);
  }),
);
