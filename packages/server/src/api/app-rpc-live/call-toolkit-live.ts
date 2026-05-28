import { CallRunEvent } from "@app/domain/service-contract";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import { CallSessionRepo } from "./call-session-repo.js";
import { CallMailbox, CallToolContext, CallToolkit } from "./call-toolkit.js";

const publishToolEvent = (event: typeof CallRunEvent.Type) =>
  Effect.gen(function*() {
    const mailbox = yield* CallMailbox;
    yield* PubSub.publish(mailbox, [event]);
  });

export const CallToolkitLive = CallToolkit.toLayer(
  Effect.gen(function*() {
    const repo = yield* CallSessionRepo;

    return {
      lookup_recommended_slots: Effect.fnUntraced(function*(params) {
        yield* publishToolEvent({
          _tag: "ToolStart",
          toolName: "lookup_recommended_slots",
          input: JSON.stringify(params),
        });

        const slotsExit = yield* Effect.exit(
          repo.listRecommendedSlots(params.zipCode, params.applianceType),
        );
        if (Exit.isFailure(slotsExit)) {
          yield* publishToolEvent({
            _tag: "ToolFailure",
            toolName: "lookup_recommended_slots",
            output: Cause.pretty(slotsExit.cause),
          });
          return yield* Effect.failCause(slotsExit.cause);
        }

        yield* publishToolEvent({
          _tag: "ToolSuccess",
          toolName: "lookup_recommended_slots",
          output: JSON.stringify(slotsExit.value),
        });

        return slotsExit.value;
      }),

      lookup_technician_load: Effect.fnUntraced(function*() {
        yield* publishToolEvent({
          _tag: "ToolStart",
          toolName: "lookup_technician_load",
          input: "{}",
        });

        const loadExit = yield* Effect.exit(repo.listTechnicianLoad);
        if (Exit.isFailure(loadExit)) {
          yield* publishToolEvent({
            _tag: "ToolFailure",
            toolName: "lookup_technician_load",
            output: Cause.pretty(loadExit.cause),
          });
          return yield* Effect.failCause(loadExit.cause);
        }

        yield* publishToolEvent({
          _tag: "ToolSuccess",
          toolName: "lookup_technician_load",
          output: JSON.stringify(loadExit.value),
        });

        return loadExit.value;
      }),

      lookup_upload_context: Effect.fnUntraced(function*() {
        const { sessionId } = yield* CallToolContext;

        yield* publishToolEvent({
          _tag: "ToolStart",
          toolName: "lookup_upload_context",
          input: JSON.stringify({ sessionId }),
        });

        const uploadsExit = yield* Effect.exit(repo.listUploadSessions(sessionId));
        if (Exit.isFailure(uploadsExit)) {
          yield* publishToolEvent({
            _tag: "ToolFailure",
            toolName: "lookup_upload_context",
            output: Cause.pretty(uploadsExit.cause),
          });
          return yield* Effect.failCause(uploadsExit.cause);
        }

        yield* publishToolEvent({
          _tag: "ToolSuccess",
          toolName: "lookup_upload_context",
          output: JSON.stringify(uploadsExit.value),
        });

        return uploadsExit.value;
      }),
    };
  }),
);
