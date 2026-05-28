import type {
  BookAppointmentInput,
  BookAppointmentOutput,
  CallRunEvent,
  CallRunWatchEvent,
  CallSessionSnapshot,
  CreateUploadLinkInput,
  CreateUploadLinkOutput,
  DashboardSnapshot,
  StartCallRunInput,
  StartCallRunOutput,
  UploadSessionSnapshot,
} from "@app/domain/service-contract";
import {
  AppointmentId,
  CallRunId,
  CallSessionId,
  SlotId,
  TechnicianId,
  UploadToken,
} from "@app/domain/service-contract";
import {
  addEqualityTesters,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vitest,
} from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  activeCallRunStateAtom,
  activeSessionIdAtom,
  activeSessionResultAtom,
  bookAppointmentMutationAtom,
  callRunStateFamily,
  createUploadLinkMutationAtom,
  DashboardApi,
  dashboardRuntime,
  dashboardSnapshotAtom,
  interruptCallRunAtom,
  selectedSessionAtom,
  startCallRunAtom,
  uploadSessionAtom,
  watchCallSessionFamily,
} from "./dashboard-atoms.js";

addEqualityTesters();

const SESSION_ID = CallSessionId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
const RUN_ID = CallRunId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12");
const OTHER_RUN_ID = CallRunId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13");
const TOKEN = UploadToken.make("upload-token-1234567890");
const SLOT_ID = SlotId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14");
const APPOINTMENT_ID = AppointmentId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15");
const TECHNICIAN_ID = TechnicianId.make("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16");

const makeUploadSession = (
  overrides: Partial<UploadSessionSnapshot> = {},
): UploadSessionSnapshot => ({
  token: overrides.token ?? TOKEN,
  status: overrides.status ?? "pending",
  email: overrides.email ?? "pat@example.com",
  uploadUrl: overrides.uploadUrl ?? "http://localhost:3000/upload/upload-token-1",
  uploadedAt: overrides.uploadedAt ?? null,
  analysisSummary: overrides.analysisSummary ?? null,
  recognizedApplianceType: overrides.recognizedApplianceType ?? null,
  visibleSignals: overrides.visibleSignals ?? [],
  expiresAt: overrides.expiresAt ?? "2026-05-26T13:00:00.000Z",
});

const makeSession = (
  overrides: Partial<CallSessionSnapshot> = {},
): CallSessionSnapshot => ({
  id: overrides.id ?? SESSION_ID,
  activeRunId: overrides.activeRunId ?? null,
  customerName: overrides.customerName ?? "Pat Jordan",
  phoneNumber: overrides.phoneNumber ?? "+1-555-0199",
  email: overrides.email ?? "pat@example.com",
  zipCode: overrides.zipCode ?? "60601",
  applianceType: overrides.applianceType ?? "refrigerator",
  status: overrides.status ?? "diagnosing",
  symptomSummary: overrides.symptomSummary ?? [],
  transcript: overrides.transcript ?? [],
  nextSteps: overrides.nextSteps ?? [],
  recommendedSlots: overrides.recommendedSlots ?? [],
  appointment: overrides.appointment ?? null,
  uploadSessions: overrides.uploadSessions ?? [],
  updatedAt: overrides.updatedAt ?? "2026-05-26T12:00:00.000Z",
});

const makeDashboard = (
  session: CallSessionSnapshot = makeSession(),
): DashboardSnapshot => ({
  sessions: [
    {
      id: session.id,
      activeRunId: session.activeRunId,
      customerName: session.customerName,
      applianceType: session.applianceType,
      status: session.status,
      latestAssistantMessage: session.transcript.at(-1)?.message ?? "",
      updatedAt: session.updatedAt,
    },
  ],
  technicianLoad: [],
  upcomingAppointments: [],
  recentEmailDeliveries: [],
});

const makeBookAppointmentInput = (): BookAppointmentInput => ({
  sessionId: SESSION_ID,
  slotId: SLOT_ID,
  customerName: "Pat Jordan",
  phoneNumber: "+1-555-0199",
  zipCode: "60601",
  applianceType: "refrigerator",
});

const makeBookAppointmentOutput = (): BookAppointmentOutput => ({
  appointment: {
    id: APPOINTMENT_ID,
    slotId: SLOT_ID,
    technicianId: TECHNICIAN_ID,
    technicianName: "Terry",
    startsAt: "2026-05-26T14:00:00.000Z",
    endsAt: "2026-05-26T15:00:00.000Z",
    applianceType: "refrigerator",
    zipCode: "60601",
    confirmationCode: "CONF-1",
  },
  session: makeSession({
    appointment: {
      id: APPOINTMENT_ID,
      slotId: SLOT_ID,
      technicianId: TECHNICIAN_ID,
      technicianName: "Terry",
      startsAt: "2026-05-26T14:00:00.000Z",
      endsAt: "2026-05-26T15:00:00.000Z",
      applianceType: "refrigerator",
      zipCode: "60601",
      confirmationCode: "CONF-1",
    },
    status: "scheduled",
  }),
});

const makeUploadLinkInput = (): CreateUploadLinkInput => ({
  sessionId: SESSION_ID,
  email: "pat@example.com",
});

const makeUploadLinkOutput = (): CreateUploadLinkOutput => ({
  uploadSession: makeUploadSession(),
  deliveryPreviewUrl: "http://localhost:3000/outbox/preview",
  emailDelivery: {
    id: "email-1",
    to: "pat@example.com",
    subject: "Upload photos",
    body: "Please upload photos",
    relatedSessionId: SESSION_ID,
    createdAt: "2026-05-26T12:30:00.000Z",
  },
});

const makeStartCallRunInput = (): StartCallRunInput => ({
  sessionId: null,
  customerName: "Pat Jordan",
  phoneNumber: "+1-555-0199",
  email: "pat@example.com",
  zipCode: "60601",
  utterance: "The refrigerator is warm.",
});

const flush = async () => {
  await Promise.resolve();
};

const makeRegistry = (options?: {
  readonly getDashboardSnapshot?: () => Effect.Effect<DashboardSnapshot, any>;
  readonly getCallSession?: (sessionId: CallSessionId) => Effect.Effect<CallSessionSnapshot, any>;
  readonly getUploadSession?: (token: UploadToken) => Effect.Effect<UploadSessionSnapshot, any>;
  readonly bookAppointment?: (
    payload: BookAppointmentInput,
  ) => Effect.Effect<BookAppointmentOutput, any>;
  readonly createUploadLink?: (
    payload: CreateUploadLinkInput,
  ) => Effect.Effect<CreateUploadLinkOutput, any>;
  readonly startCallRun?: (payload: StartCallRunInput) => Effect.Effect<StartCallRunOutput, any>;
  readonly callRunEvents?: (runId: CallRunId) => Stream.Stream<CallRunEvent, any>;
  readonly callRunWatch?: (sessionId: CallSessionId) => Stream.Stream<CallRunWatchEvent, any>;
  readonly interruptCallRun?: (sessionId: CallSessionId) => Effect.Effect<void, any>;
}) => {
  const calls = {
    getDashboardSnapshot: 0,
    getCallSession: [] as Array<CallSessionId>,
    getUploadSession: [] as Array<UploadToken>,
    bookAppointment: [] as Array<BookAppointmentInput>,
    createUploadLink: [] as Array<CreateUploadLinkInput>,
    startCallRun: [] as Array<StartCallRunInput>,
    callRunEvents: [] as Array<CallRunId>,
    callRunWatch: [] as Array<CallSessionId>,
    interruptCallRun: [] as Array<CallSessionId>,
  };

  const layer = Layer.mock(DashboardApi)({
    getDashboardSnapshot: () => {
      calls.getDashboardSnapshot += 1;
      return options?.getDashboardSnapshot?.() ?? Effect.succeed(makeDashboard());
    },
    getCallSession: (sessionId) => {
      calls.getCallSession.push(sessionId);
      return options?.getCallSession?.(sessionId) ?? Effect.succeed(makeSession({ id: sessionId }));
    },
    getUploadSession: (token) => {
      calls.getUploadSession.push(token);
      return options?.getUploadSession?.(token) ?? Effect.succeed(makeUploadSession({ token }));
    },
    bookAppointment: (payload) => {
      calls.bookAppointment.push(payload);
      return options?.bookAppointment?.(payload) ?? Effect.succeed(makeBookAppointmentOutput());
    },
    createUploadLink: (payload) => {
      calls.createUploadLink.push(payload);
      return options?.createUploadLink?.(payload) ?? Effect.succeed(makeUploadLinkOutput());
    },
    startCallRun: (payload) => {
      calls.startCallRun.push(payload);
      return options?.startCallRun?.(payload)
        ?? Effect.succeed({ runId: RUN_ID, sessionId: SESSION_ID });
    },
    callRunEvents: (runId) => {
      calls.callRunEvents.push(runId);
      return options?.callRunEvents?.(runId) ?? Stream.never;
    },
    callRunWatch: (sessionId) => {
      calls.callRunWatch.push(sessionId);
      return options?.callRunWatch?.(sessionId) ?? Stream.never;
    },
    interruptCallRun: (sessionId) => {
      calls.interruptCallRun.push(sessionId);
      return options?.interruptCallRun?.(sessionId) ?? Effect.void;
    },
  });

  return {
    calls,
    registry: AtomRegistry.make({
      initialValues: [Atom.initialValue(dashboardRuntime.layer, layer)],
    }),
  };
};

describe("dashboard atoms", () => {
  beforeEach(() => {
    vitest.useFakeTimers();
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  it("derives the active selectors from the active session id", async () => {
    const { registry } = makeRegistry();

    expect(registry.get(activeSessionResultAtom)).toBeNull();
    expect(registry.get(activeCallRunStateAtom)).toEqual({ _tag: "Idle" });

    registry.set(activeSessionIdAtom, SESSION_ID);
    registry.mount(selectedSessionAtom(SESSION_ID));
    await flush();

    const activeSessionResult = registry.get(activeSessionResultAtom);
    expect(activeSessionResult).not.toBeNull();
    if (activeSessionResult !== null && AsyncResult.isSuccess(activeSessionResult)) {
      expect(activeSessionResult.value.id).toBe(SESSION_ID);
    }
    expect(registry.get(activeCallRunStateAtom)).toEqual({ _tag: "Idle" });
  });

  it("accumulates run events, refreshes the queries, and completes with the final assistant message", async () => {
    let sessionReads = 0;
    const { calls, registry } = makeRegistry({
      getDashboardSnapshot: () => Effect.succeed(makeDashboard(makeSession({ id: SESSION_ID }))),
      getCallSession: (sessionId) =>
        Effect.succeed(
          sessionReads++ === 0
            ? makeSession({ id: sessionId, activeRunId: RUN_ID })
            : makeSession({
              id: sessionId,
              activeRunId: RUN_ID,
              transcript: [{
                role: "assistant",
                message: "Final answer",
                at: "2026-05-26T12:01:00.000Z",
              }],
            }),
        ),
      startCallRun: () => Effect.succeed({ runId: RUN_ID, sessionId: SESSION_ID }),
      callRunEvents: () =>
        Stream.make(
          { _tag: "Chunk", delta: "Hello" } as const,
          { _tag: "ToolStart", toolName: "lookup_recommended_slots", input: "{}" } as const,
          { _tag: "Chunk", delta: " world" } as const,
          {
            _tag: "RunCompleted",
            sessionId: SESSION_ID,
            assistantMessage: "Final answer",
          } as const,
        ),
    });

    const unmountDashboard = registry.mount(dashboardSnapshotAtom);
    const unmountSession = registry.mount(selectedSessionAtom(SESSION_ID));
    const unmountStart = registry.mount(startCallRunAtom);
    registry.set(startCallRunAtom, makeStartCallRunInput());
    await flush();

    expect(calls.getDashboardSnapshot).toBeGreaterThanOrEqual(2);
    expect(calls.getCallSession.filter((sessionId) => sessionId === SESSION_ID)).toHaveLength(2);
    expect(registry.get(activeSessionIdAtom)).toBe(SESSION_ID);
    expect(registry.get(callRunStateFamily(SESSION_ID))).toEqual({
      _tag: "Completed",
      runId: RUN_ID,
      assistantMessage: "Final answer",
      events: [
        { _tag: "Chunk", delta: "Hello" },
        { _tag: "ToolStart", toolName: "lookup_recommended_slots", input: "{}" },
        { _tag: "Chunk", delta: " world" },
        { _tag: "RunCompleted", sessionId: SESSION_ID, assistantMessage: "Final answer" },
      ],
    });

    unmountStart();
    unmountSession();
    unmountDashboard();
  });

  it("marks interrupted runs on local interruption and failed runs on stream failure", async () => {
    const interruptedGate = Effect.runSync(Deferred.make<void>());
    const { registry: interruptedRegistry } = makeRegistry({
      startCallRun: () => Effect.succeed({ runId: RUN_ID, sessionId: SESSION_ID }),
      getCallSession: () => Effect.succeed(makeSession({ id: SESSION_ID, activeRunId: RUN_ID })),
      interruptCallRun: () => Deferred.interrupt(interruptedGate).pipe(Effect.asVoid),
      callRunEvents: () =>
        Stream.fromEffect(Deferred.await(interruptedGate)).pipe(Stream.flatMap(() => Stream.empty)),
    });

    const unmountInterruptedStart = interruptedRegistry.mount(startCallRunAtom);
    const unmountInterruptedInterrupt = interruptedRegistry.mount(interruptCallRunAtom);
    interruptedRegistry.set(startCallRunAtom, makeStartCallRunInput());
    await flush();
    interruptedRegistry.set(interruptCallRunAtom, { sessionId: SESSION_ID });
    await flush();

    expect(interruptedRegistry.get(callRunStateFamily(SESSION_ID))).toMatchObject({
      _tag: "Interrupted",
      runId: RUN_ID,
    });
    unmountInterruptedInterrupt();
    unmountInterruptedStart();

    const { calls, registry: failedRegistry } = makeRegistry({
      getDashboardSnapshot: () => Effect.succeed(makeDashboard()),
      getCallSession: () => Effect.succeed(makeSession({ id: SESSION_ID, activeRunId: RUN_ID })),
      startCallRun: () => Effect.succeed({ runId: RUN_ID, sessionId: SESSION_ID }),
      callRunEvents: () => Stream.fail("stream-failed"),
    });

    const unmountFailedDashboard = failedRegistry.mount(dashboardSnapshotAtom);
    const unmountFailedSession = failedRegistry.mount(selectedSessionAtom(SESSION_ID));
    const unmountFailedStart = failedRegistry.mount(startCallRunAtom);
    failedRegistry.set(startCallRunAtom, makeStartCallRunInput());
    await flush();

    const localState = failedRegistry.get(callRunStateFamily(SESSION_ID));
    expect(localState._tag).toBe("Failed");
    if (localState._tag === "Failed") {
      expect(String(localState.cause)).toContain("stream-failed");
    }
    expect(calls.getDashboardSnapshot).toBeGreaterThanOrEqual(2);
    expect(calls.getCallSession.filter((sessionId) => sessionId === SESSION_ID)).toHaveLength(2);
    unmountFailedStart();
    unmountFailedSession();
    unmountFailedDashboard();
  });

  it("does not let a stale run overwrite a newer attached run", async () => {
    const firstRunGate = Effect.runSync(Deferred.make<void>());
    const secondRunGate = Effect.runSync(Deferred.make<void>());
    const { registry } = makeRegistry({
      callRunEvents: (runId) =>
        runId === RUN_ID
          ? Stream.fromEffect(Deferred.await(firstRunGate)).pipe(
            Stream.flatMap(() =>
              Stream.make(
                { _tag: "RunCompleted", sessionId: SESSION_ID, assistantMessage: "old" } as const,
              )
            ),
          )
          : Stream.make({ _tag: "Chunk", delta: "new" } as const).pipe(
            Stream.concat(
              Stream.fromEffect(Deferred.await(secondRunGate)).pipe(
                Stream.flatMap(() => Stream.empty),
              ),
            ),
          ),
      callRunWatch: () => Stream.make({ _tag: "RunChanged", runId: OTHER_RUN_ID } as const),
      getCallSession: (sessionId) =>
        Effect.succeed(makeSession({ id: sessionId, activeRunId: RUN_ID })),
    });

    const unmountRunState = registry.mount(callRunStateFamily(SESSION_ID));
    await flush();

    Effect.runSync(Deferred.succeed(firstRunGate, undefined));
    await flush();

    expect(registry.get(callRunStateFamily(SESSION_ID))).toEqual({
      _tag: "Streaming",
      runId: OTHER_RUN_ID,
      assistantMessage: "new",
      events: [{ _tag: "Chunk", delta: "new" }],
    });
    Effect.runSync(Deferred.succeed(secondRunGate, undefined));
    unmountRunState();
  });

  it("attaches the initial watched run id", async () => {
    const runGate = Effect.runSync(Deferred.make<void>());
    const { calls, registry } = makeRegistry({
      callRunEvents: () =>
        Stream.fromEffect(Deferred.await(runGate)).pipe(Stream.flatMap(() => Stream.empty)),
      callRunWatch: () => Stream.empty,
      getCallSession: (sessionId) =>
        Effect.succeed(makeSession({ id: sessionId, activeRunId: RUN_ID })),
    });

    const unmountRunState = registry.mount(callRunStateFamily(SESSION_ID));
    await flush();

    expect(calls.callRunEvents).toEqual([RUN_ID]);

    Effect.runSync(Deferred.succeed(runGate, undefined));
    unmountRunState();
  });

  it("ignores the same watched run and reattaches a new run", async () => {
    const nextRunGate = Effect.runSync(Deferred.make<void>());
    const { calls, registry } = makeRegistry({
      callRunEvents: () =>
        Stream.fromEffect(Deferred.await(nextRunGate)).pipe(Stream.flatMap(() => Stream.empty)),
      callRunWatch: () =>
        Stream.make(
          { _tag: "RunChanged", runId: RUN_ID } as const,
          { _tag: "RunChanged", runId: OTHER_RUN_ID } as const,
        ),
      getCallSession: (sessionId) =>
        Effect.succeed(makeSession({ id: sessionId, activeRunId: RUN_ID })),
    });

    const unmountRunState = registry.mount(callRunStateFamily(SESSION_ID));
    await flush();
    await flush();

    expect(calls.callRunEvents).toContain(OTHER_RUN_ID);
    expect(calls.callRunEvents.filter((runId) => runId === OTHER_RUN_ID)).toHaveLength(1);
    Effect.runSync(Deferred.succeed(nextRunGate, undefined));
    unmountRunState();
  });

  it("refreshes dashboard and session when the watch stream reports a null run id", async () => {
    const { calls, registry } = makeRegistry({
      callRunWatch: () => Stream.make({ _tag: "RunChanged", runId: null } as const),
      getDashboardSnapshot: () => Effect.succeed(makeDashboard()),
      getCallSession: (sessionId) => Effect.succeed(makeSession({ id: sessionId })),
    });

    const unmountDashboard = registry.mount(dashboardSnapshotAtom);
    const unmountSession = registry.mount(selectedSessionAtom(SESSION_ID));
    const unmountWatch = registry.mount(watchCallSessionFamily(SESSION_ID));
    await flush();
    await flush();

    expect(calls.getDashboardSnapshot).toBeGreaterThanOrEqual(2);
    expect(calls.getCallSession.filter((sessionId) => sessionId === SESSION_ID)).toHaveLength(2);
    unmountWatch();
    unmountSession();
    unmountDashboard();
  });

  it("propagates query failures through AsyncResult", async () => {
    const { registry } = makeRegistry({
      getDashboardSnapshot: () => Effect.fail("dashboard-failed"),
      getCallSession: () => Effect.fail("session-failed"),
      getUploadSession: () => Effect.fail("upload-failed"),
    });

    registry.mount(dashboardSnapshotAtom);
    registry.mount(selectedSessionAtom(SESSION_ID));
    registry.mount(uploadSessionAtom(TOKEN));
    await flush();

    expect(AsyncResult.isFailure(registry.get(dashboardSnapshotAtom))).toBe(true);
    expect(AsyncResult.isFailure(registry.get(selectedSessionAtom(SESSION_ID)))).toBe(true);
    expect(AsyncResult.isFailure(registry.get(uploadSessionAtom(TOKEN)))).toBe(true);
  });

  it("refreshes dashboard and session after successful mutations and surfaces failures without refresh", async () => {
    const { calls, registry } = makeRegistry({
      getDashboardSnapshot: () => Effect.succeed(makeDashboard()),
      getCallSession: (sessionId) => Effect.succeed(makeSession({ id: sessionId })),
    });

    const unmountDashboard = registry.mount(dashboardSnapshotAtom);
    const unmountSession = registry.mount(selectedSessionAtom(SESSION_ID));
    const unmountBook = registry.mount(bookAppointmentMutationAtom);
    const unmountUpload = registry.mount(createUploadLinkMutationAtom);
    await flush();

    const initialDashboardCalls = calls.getDashboardSnapshot;
    const initialSessionCalls = calls.getCallSession.length;

    registry.set(bookAppointmentMutationAtom, makeBookAppointmentInput());
    await flush();
    registry.set(createUploadLinkMutationAtom, makeUploadLinkInput());
    await flush();

    expect(calls.getDashboardSnapshot).toBe(initialDashboardCalls + 2);
    expect(calls.getCallSession.length).toBe(initialSessionCalls + 2);
    expect(AsyncResult.isSuccess(registry.get(bookAppointmentMutationAtom))).toBe(true);
    expect(AsyncResult.isSuccess(registry.get(createUploadLinkMutationAtom))).toBe(true);
    unmountUpload();
    unmountBook();
    unmountSession();
    unmountDashboard();

    const failed = makeRegistry({
      getDashboardSnapshot: () => Effect.succeed(makeDashboard()),
      getCallSession: (sessionId) => Effect.succeed(makeSession({ id: sessionId })),
      bookAppointment: () => Effect.fail("book-failed"),
      createUploadLink: () => Effect.fail("upload-failed"),
      interruptCallRun: () => Effect.fail("interrupt-failed"),
    });

    const unmountFailedDashboard = failed.registry.mount(dashboardSnapshotAtom);
    const unmountFailedSession = failed.registry.mount(selectedSessionAtom(SESSION_ID));
    const unmountFailedBook = failed.registry.mount(bookAppointmentMutationAtom);
    const unmountFailedUpload = failed.registry.mount(createUploadLinkMutationAtom);
    const unmountFailedInterrupt = failed.registry.mount(interruptCallRunAtom);
    await flush();

    const failedDashboardCalls = failed.calls.getDashboardSnapshot;
    const failedSessionCalls = failed.calls.getCallSession.length;

    failed.registry.set(bookAppointmentMutationAtom, makeBookAppointmentInput());
    failed.registry.set(createUploadLinkMutationAtom, makeUploadLinkInput());
    failed.registry.set(interruptCallRunAtom, { sessionId: SESSION_ID });
    await flush();

    expect(AsyncResult.isFailure(failed.registry.get(bookAppointmentMutationAtom))).toBe(true);
    expect(AsyncResult.isFailure(failed.registry.get(createUploadLinkMutationAtom))).toBe(true);
    expect(AsyncResult.isFailure(failed.registry.get(interruptCallRunAtom))).toBe(true);
    expect(failed.calls.getDashboardSnapshot).toBe(failedDashboardCalls);
    expect(failed.calls.getCallSession.length).toBe(failedSessionCalls);
    unmountFailedInterrupt();
    unmountFailedUpload();
    unmountFailedBook();
    unmountFailedSession();
    unmountFailedDashboard();
  });

  it("reuses the watch stream before idle ttl expiry and recreates it after one minute", async () => {
    const { calls, registry } = makeRegistry({
      callRunWatch: () => Stream.empty,
    });

    const watchAtom = watchCallSessionFamily(SESSION_ID);
    const unmountFirst = registry.mount(watchAtom);
    await flush();
    unmountFirst();

    await vitest.advanceTimersByTimeAsync(59_000);
    const unmountSecond = registry.mount(watchAtom);
    await flush();
    unmountSecond();

    await vitest.advanceTimersByTimeAsync(61_000);
    const unmountThird = registry.mount(watchAtom);
    await flush();
    unmountThird();

    expect(calls.callRunWatch).toEqual([SESSION_ID, SESSION_ID]);
  });

  it("leaves non streaming run state unchanged when interrupting and interrupts watchers on finalizer", async () => {
    const { calls, registry } = makeRegistry({
      getDashboardSnapshot: () => Effect.succeed(makeDashboard()),
      getCallSession: (sessionId) =>
        Effect.succeed(makeSession({
          id: sessionId,
          activeRunId: RUN_ID,
          transcript: [{ role: "assistant", message: "done", at: "2026-05-26T12:01:00.000Z" }],
        })),
      callRunEvents: () =>
        Stream.make(
          { _tag: "RunCompleted", sessionId: SESSION_ID, assistantMessage: "done" } as const,
        ),
      startCallRun: () => Effect.succeed({ runId: RUN_ID, sessionId: SESSION_ID }),
    });

    const unmountDashboard = registry.mount(dashboardSnapshotAtom);
    const unmountSession = registry.mount(selectedSessionAtom(SESSION_ID));
    const unmountStart = registry.mount(startCallRunAtom);
    const unmountInterrupt = registry.mount(interruptCallRunAtom);
    registry.set(startCallRunAtom, makeStartCallRunInput());
    await flush();

    registry.set(interruptCallRunAtom, { sessionId: SESSION_ID });
    await flush();

    expect(registry.get(callRunStateFamily(SESSION_ID))).toEqual({
      _tag: "Completed",
      runId: RUN_ID,
      assistantMessage: "done",
      events: [{ _tag: "RunCompleted", sessionId: SESSION_ID, assistantMessage: "done" }],
    });
    expect(calls.interruptCallRun).toEqual([SESSION_ID]);
    unmountInterrupt();
    unmountStart();
    unmountSession();
    unmountDashboard();
  });
});
