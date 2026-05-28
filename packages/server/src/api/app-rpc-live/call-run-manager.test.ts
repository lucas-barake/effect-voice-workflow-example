import { AppConfig } from "@/config.js";
import { CallRunInProgress, CallSessionId, SessionNotFound } from "@app/domain/service-contract";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { AiModels } from "./ai-models.js";
import { CallProcessor } from "./call-processor.js";
import { CallRunManager } from "./call-run-manager.js";
import { CallSessionModel } from "./call-session-model.js";
import { CallSessionRepo } from "./call-session-repo.js";

const SESSION_ID = CallSessionId.make("40000000-0000-4000-8000-000000000021");

const TestConfig = Layer.succeed(AppConfig, {
  publicAppOrigin: "http://localhost:4173",
  publicWebhookBaseUrl: null,
  twilioAuthToken: null,
  uploadDirectory: "./data/uploads",
  serverPort: 3000,
  localLlmApiUrl: "http://127.0.0.1:11434/v1",
  localLlmApiKey: null,
});

const makeSession = (overrides?: Partial<typeof CallSessionModel.Type>) =>
  new CallSessionModel({
    id: SESSION_ID,
    customerName: "Pat Doe",
    phoneNumber: "+15550100",
    email: "pat@example.com",
    zipCode: "10001",
    applianceType: null,
    status: "intake",
    transcript: [],
    symptomSummary: [],
    nextSteps: [],
    latestAssistantMessage: "",
    appointmentId: null,
    activeRunId: null,
    createdAt: DateTime.nowUnsafe(),
    updatedAt: DateTime.nowUnsafe(),
    ...overrides,
  });

const makeLayer = (args: {
  readonly repo: ReturnType<typeof CallSessionRepo.of>;
  readonly processor: ReturnType<typeof CallProcessor.of>;
}) =>
  Layer.effect(CallRunManager, CallRunManager.make).pipe(
    Layer.provide(AiModels.layer),
    Layer.provide(TestConfig),
    Layer.provide(Layer.succeed(CallSessionRepo, args.repo)),
    Layer.provide(Layer.succeed(CallProcessor, args.processor)),
    Layer.provide(WorkflowEngine.layerMemory),
  );

describe("CallRunManager", () => {
  it.effect("fails when starting a provided session id that does not exist", () =>
    Effect.gen(function*() {
      const manager = yield* CallRunManager;
      const exit = yield* manager.start({
        sessionId: SESSION_ID,
        customerName: null,
        phoneNumber: "+15550199",
        email: null,
        zipCode: null,
        utterance: "My refrigerator is warm",
      }).pipe(Effect.exit);

      expect(exit).toEqual(Exit.fail(new SessionNotFound({ sessionId: SESSION_ID })));
    }).pipe(
      Effect.provide(makeLayer({
        repo: CallSessionRepo.of({
          findById: () => Effect.fail(new SessionNotFound({ sessionId: SESSION_ID })),
          findOption: () => Effect.die("unused"),
          createIfMissing: () => Effect.die("unused"),
          startRun: () => Effect.die("unused"),
          finishRun: () => Effect.die("unused"),
          clearActiveRun: () => Effect.die("unused"),
          listRecent: Effect.die("unused"),
          listRecommendedSlots: () => Effect.die("unused"),
          listTechnicianLoad: Effect.die("unused"),
          listUploadSessions: () => Effect.die("unused"),
        }),
        processor: CallProcessor.of({
          run: () => Effect.die("unused"),
        }),
      })),
    ));

  it.effect("fails with CallRunInProgress when the session already has an active run", () =>
    Effect.gen(function*() {
      const session = makeSession();
      const manager = yield* CallRunManager;
      const exit = yield* manager.start({
        sessionId: SESSION_ID,
        customerName: null,
        phoneNumber: "+15550199",
        email: null,
        zipCode: null,
        utterance: "My refrigerator is warm",
      }).pipe(Effect.exit);

      expect(exit).toEqual(Exit.fail(new CallRunInProgress({ sessionId: SESSION_ID })));
      expect(session.activeRunId).toBeNull();
    }).pipe(
      Effect.provide(makeLayer({
        repo: (() => {
          const session = makeSession();
          return CallSessionRepo.of({
            findById: () => Effect.succeed(session),
            findOption: () => Effect.die("unused"),
            createIfMissing: () => Effect.succeed(session),
            startRun: () => Effect.succeed(false),
            finishRun: () => Effect.die("unused"),
            clearActiveRun: () => Effect.void,
            listRecent: Effect.die("unused"),
            listRecommendedSlots: () => Effect.die("unused"),
            listTechnicianLoad: Effect.die("unused"),
            listUploadSessions: () => Effect.die("unused"),
          });
        })(),
        processor: CallProcessor.of({
          run: () => Effect.die("unused"),
        }),
      })),
    ));

  it.effect("starts a run, emits watch and run events, and persists the completed session", () => {
    let session = makeSession();
    let releaseRun!: Deferred.Deferred<void>;
    const processorCalls: Array<readonly [typeof CallSessionModel.Type, string]> = [];

    return Effect.gen(function*() {
      releaseRun = yield* Deferred.make<void>();
      const manager = yield* CallRunManager;
      const watchFiber = yield* Stream.runCollect(
        manager.watch(SESSION_ID).pipe(Stream.take(2)),
      ).pipe(Effect.forkScoped);

      const started = yield* manager.start({
        sessionId: SESSION_ID,
        customerName: null,
        phoneNumber: "+15550199",
        email: null,
        zipCode: null,
        utterance: "My refrigerator is warm",
      });

      const eventFiber = yield* Stream.runCollect(
        manager.events(started.runId).pipe(Stream.take(1)),
      ).pipe(Effect.forkScoped);

      yield* Deferred.succeed(releaseRun, undefined);

      const watched = [...(yield* Fiber.join(watchFiber))];
      const events = [...(yield* Fiber.join(eventFiber))];

      expect(processorCalls).toHaveLength(1);
      expect(processorCalls[0]?.[0].activeRunId).toBe(started.runId);
      expect(processorCalls[0]?.[0].status).toBe("intake");
      expect(processorCalls[0]?.[1]).toBe("My refrigerator is warm");
      expect(watched).toEqual([
        { _tag: "RunChanged", runId: started.runId },
        { _tag: "RunChanged", runId: null },
      ]);
      expect(events).toEqual([{
        _tag: "RunCompleted",
        sessionId: SESSION_ID,
        assistantMessage: "Please check the condenser coils.",
      }]);
      expect(session.activeRunId).toBeNull();
      expect(session.latestAssistantMessage).toBe("Please check the condenser coils.");
      expect(session.status).toBe("troubleshooting");
    }).pipe(
      Effect.provide(makeLayer({
        repo: CallSessionRepo.of({
          findById: () => Effect.succeed(session),
          findOption: () => Effect.succeed(Option.none()),
          createIfMissing: () => Effect.succeed(session),
          startRun: ({ runId }) =>
            Effect.sync(() => {
              if (session.activeRunId !== null) {
                return false;
              }
              session = makeSession({ activeRunId: runId });
              return true;
            }),
          finishRun: (args) =>
            Effect.sync(() => {
              session = makeSession({
                customerName: args.customerName,
                phoneNumber: args.phoneNumber,
                email: args.email,
                zipCode: args.zipCode,
                applianceType: args.applianceType,
                status: args.status,
                transcript: args.transcript,
                symptomSummary: args.symptomSummary,
                nextSteps: args.nextSteps,
                latestAssistantMessage: args.latestAssistantMessage,
                activeRunId: null,
              });
            }),
          clearActiveRun: () =>
            Effect.sync(() => {
              session = makeSession({ ...session, activeRunId: null });
            }),
          listRecent: Effect.die("unused"),
          listRecommendedSlots: () => Effect.die("unused"),
          listTechnicianLoad: Effect.die("unused"),
          listUploadSessions: () => Effect.die("unused"),
        }),
        processor: CallProcessor.of({
          run: Effect.fnUntraced(function*(currentSession, input) {
            processorCalls.push([currentSession, input.utterance]);
            yield* Deferred.await(releaseRun);
            return {
              customerName: currentSession.customerName,
              phoneNumber: input.phoneNumber ?? currentSession.phoneNumber,
              email: currentSession.email,
              zipCode: currentSession.zipCode,
              applianceType: "refrigerator" as const,
              status: "troubleshooting" as const,
              symptomSummary: [],
              nextSteps: [{
                key: "check-condenser-coils",
                instruction: "Please check the condenser coils.",
                completionHint: "Tell me whether the coils look dusty.",
              }],
              assistantMessage: "Please check the condenser coils.",
              transcript: [{
                role: "assistant" as const,
                message: "Please check the condenser coils.",
                at: "2026-05-27T12:00:00.000Z",
              }],
            };
          }),
        }),
      })),
    );
  });
});
