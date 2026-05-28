import {
  CallRunId,
  CallRunInProgress,
  CallRunNotFound,
  CallSessionId,
  SessionNotFound,
  StartCallRunInput,
} from "@app/domain/service-contract";
import type {
  CallRunEvent as CallRunEventType,
  CallRunWatchEvent as CallRunWatchEventType,
} from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Workflow from "effect/unstable/workflow/Workflow";
import * as WorkflowEngine from "effect/unstable/workflow/WorkflowEngine";
import { randomUUID } from "node:crypto";
import { AiModels } from "./ai-models.js";
import { CallProcessor } from "./call-processor.js";
import { CallSessionRepo } from "./call-session-repo.js";
import { CallToolkitLive } from "./call-toolkit-live.js";
import { CallMailbox, CallToolContext } from "./call-toolkit.js";
import { WorkflowRunCoordinator } from "./workflow-run-coordinator.js";

const CallRunWorkflow = Workflow.make({
  name: "service-platform/CallRunWorkflow",
  payload: {
    runId: CallRunId,
    sessionId: CallSessionId,
    input: StartCallRunInput,
  },
  success: Schema.Struct({
    assistantMessage: Schema.String,
  }).annotate({ identifier: "CallRunWorkflowSuccess" }),
  idempotencyKey: ({ runId }) => runId,
});

export class CallRunManager extends Context.Service<CallRunManager, {
  readonly watch: (
    sessionId: typeof CallSessionId.Type,
  ) => Stream.Stream<CallRunWatchEventType, SessionNotFound>;
  readonly events: (
    runId: typeof CallRunId.Type,
  ) => Stream.Stream<CallRunEventType, CallRunNotFound>;
  readonly start: (
    input: typeof StartCallRunInput.Type,
  ) => Effect.Effect<
    { readonly runId: typeof CallRunId.Type; readonly sessionId: typeof CallSessionId.Type; },
    SessionNotFound | CallRunInProgress
  >;
  readonly interrupt: (
    sessionId: typeof CallSessionId.Type,
  ) => Effect.Effect<void, SessionNotFound>;
}>()("CallRunManager", {
  make: Effect.gen(function*() {
    const aiModels = yield* AiModels;
    const processor = yield* CallProcessor;
    const repo = yield* CallSessionRepo;

    const runs = yield* WorkflowRunCoordinator.make<
      typeof CallSessionId.Type,
      typeof CallRunId.Type,
      CallRunEventType,
      "service-platform/CallRunWorkflow",
      typeof CallRunWorkflow.payloadSchema,
      typeof CallRunWorkflow.successSchema,
      typeof CallRunWorkflow.errorSchema,
      { readonly sessionId: typeof CallSessionId.Type; },
      CallRunNotFound,
      CallRunInProgress
    >({
      workflow: CallRunWorkflow,
      ownerId: (payload) => payload.sessionId,
      runId: (payload) => payload.runId,
      missingRun: (runId) => new CallRunNotFound({ runId }),
      busy: (sessionId) => new CallRunInProgress({ sessionId }),
      prepare: Effect.fnUntraced(function*(payload) {
        yield* repo.createIfMissing({
          sessionId: payload.sessionId,
          customerName: payload.input.customerName ?? null,
          phoneNumber: payload.input.phoneNumber ?? null,
          email: payload.input.email ?? null,
          zipCode: payload.input.zipCode ?? null,
        });

        const started = yield* repo.startRun({
          sessionId: payload.sessionId,
          runId: payload.runId,
        });
        if (!started) {
          return yield* Effect.fail(new CallRunInProgress({ sessionId: payload.sessionId }));
        }

        return { sessionId: payload.sessionId };
      }),
      run: Effect.fnUntraced(function*({ payload, mailbox }) {
        const session = yield* repo.findById(payload.sessionId).pipe(
          Effect.catch((error) => Effect.die(error)),
        );
        const result = yield* processor.run(session, payload.input).pipe(
          aiModels.use("chat"),
          Effect.provide(CallToolkitLive),
          Effect.provideService(CallMailbox, mailbox),
          Effect.provideService(CallSessionRepo, repo),
          Effect.provideService(CallToolContext, { sessionId: payload.sessionId }),
          Effect.catch((error) => Effect.die(error)),
        );

        yield* repo.finishRun({
          sessionId: payload.sessionId,
          runId: payload.runId,
          customerName: result.customerName,
          phoneNumber: result.phoneNumber,
          email: result.email,
          zipCode: result.zipCode,
          applianceType: result.applianceType,
          status: result.status,
          transcript: result.transcript,
          symptomSummary: result.symptomSummary,
          nextSteps: result.nextSteps,
          latestAssistantMessage: result.assistantMessage,
        });

        yield* PubSub.publish(mailbox, [{
          _tag: "RunCompleted",
          sessionId: payload.sessionId,
          assistantMessage: result.assistantMessage,
        }]);

        return { assistantMessage: result.assistantMessage };
      }),
      finalize: ({ payload }) =>
        repo.clearActiveRun({
          sessionId: payload.sessionId,
          runId: payload.runId,
        }),
    });

    return {
      watch: (sessionId) =>
        Stream.unwrap(
          repo.findById(sessionId).pipe(
            Effect.as(
              runs.changes(sessionId).pipe(
                Stream.map((runId) => ({
                  _tag: "RunChanged",
                  runId,
                })),
              ),
            ),
          ),
        ),
      events: (runId) =>
        Stream.unwrap(
          runs.resolve(runId).pipe(
            Effect.map((resolved) => resolved.events),
          ),
        ),
      start: Effect.fnUntraced(function*(input) {
        const sessionId = input.sessionId ?? CallSessionId.make(randomUUID());
        if (input.sessionId !== null && input.sessionId !== undefined) {
          yield* repo.findById(input.sessionId);
        }
        const { runId } = yield* runs.start({
          runId: CallRunId.make(randomUUID()),
          sessionId,
          input,
        });
        return { runId, sessionId };
      }),
      interrupt: (sessionId) =>
        repo.findById(sessionId).pipe(
          Effect.andThen(runs.interrupt(sessionId)),
        ),
    };
  }),
}) {
  static layer = Layer.effect(
    this,
    this.make,
  ).pipe(
    Layer.provide(AiModels.layer),
    Layer.provide(CallSessionRepo.layer),
    Layer.provide(CallProcessor.layer),
    Layer.provide(WorkflowEngine.layerMemory),
  );
}
