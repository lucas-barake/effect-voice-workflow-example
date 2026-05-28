import { CallRunEvent } from "@app/domain/service-contract";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as PubSub from "effect/PubSub";
import { CallSessionRepo } from "./call-session-repo.js";
import { CallMailbox, CallToolContext, CallToolkit } from "./call-toolkit.js";
import { ServicePlatform } from "./service-platform.js";

const publishToolEvent = (event: typeof CallRunEvent.Type) =>
  Effect.gen(function*() {
    const mailbox = yield* CallMailbox;
    yield* PubSub.publish(mailbox, [event]);
  });

export const CallToolkitLive = CallToolkit.toLayer({
  lookup_recommended_slots: Effect.fnUntraced(function*(params) {
    const repo = yield* CallSessionRepo;

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

  book_appointment: Effect.fnUntraced(function*(params) {
    const repo = yield* CallSessionRepo;
    const servicePlatform = yield* ServicePlatform;
    const { sessionId } = yield* CallToolContext;
    const session = yield* repo.findById(sessionId).pipe(
      Effect.catchTag(
        "SessionNotFound",
        () => Effect.fail("The call session could not be found for this booking."),
      ),
    );
    const zipCode = session.zipCode;
    if (zipCode === null) {
      return yield* Effect.fail("Need the caller's zip code before booking a visit.");
    }
    const applianceType = session.applianceType;
    if (applianceType === null) {
      return yield* Effect.fail("Need the appliance type before booking a visit.");
    }

    yield* publishToolEvent({
      _tag: "ToolStart",
      toolName: "book_appointment",
      input: JSON.stringify({
        sessionId,
        slotId: params.slotId,
      }),
    });

    const bookingExit = yield* Effect.exit(
      servicePlatform.bookAppointment({
        sessionId,
        slotId: params.slotId,
        customerName: session.customerName,
        phoneNumber: session.phoneNumber,
        zipCode,
        applianceType,
      }).pipe(
        Effect.catchTag(
          "SessionNotFound",
          () => Effect.fail("The call session could not be found for this booking."),
        ),
        Effect.catchTag(
          "NoMatchingTechnician",
          () => Effect.fail("That slot no longer matches the caller's appliance or zip code."),
        ),
        Effect.catchTag(
          "SlotAlreadyBooked",
          () => Effect.fail("That appointment slot is no longer available."),
        ),
      ),
    );
    if (Exit.isFailure(bookingExit)) {
      yield* publishToolEvent({
        _tag: "ToolFailure",
        toolName: "book_appointment",
        output: Cause.pretty(bookingExit.cause),
      });
      return yield* Effect.failCause(bookingExit.cause);
    }

    yield* publishToolEvent({
      _tag: "ToolSuccess",
      toolName: "book_appointment",
      output: JSON.stringify(bookingExit.value.appointment),
    });

    return bookingExit.value.appointment;
  }),

  lookup_technician_load: Effect.fnUntraced(function*() {
    const repo = yield* CallSessionRepo;

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
    const repo = yield* CallSessionRepo;
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
});
