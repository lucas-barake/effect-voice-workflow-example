import {
  CallRunEvent,
  CallSessionId,
  SlotId,
  TechnicianId,
  UploadToken,
} from "@app/domain/service-contract";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import type * as Take from "effect/Take";
import { CallSessionRepo } from "./call-session-repo.js";
import { CallToolkitLive } from "./call-toolkit-live.js";
import { CallMailbox, CallToolContext, CallToolkit } from "./call-toolkit.js";
import { ServicePlatform } from "./service-platform.js";

const SESSION_ID = CallSessionId.make("40000000-0000-4000-8000-000000000011");

const readEvents = (
  mailbox: PubSub.PubSub<Take.Take<typeof CallRunEvent.Type>>,
  count: number,
) =>
  Stream.fromPubSubTake(mailbox).pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((events) => [...events]),
  );

describe("CallToolkitLive", () => {
  it.effect("publishes tool start and success for recommended slots", () =>
    Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });
      const slots = [{
        id: SlotId.make("50000000-0000-4000-8000-000000000001"),
        technicianId: TechnicianId.make("50000000-0000-4000-8000-000000000002"),
        technicianName: "Ana",
        startsAt: "2026-05-27T19:00:00.000Z",
        endsAt: "2026-05-27T21:00:00.000Z",
        applianceType: "refrigerator" as const,
        zipCode: "10001",
      }];

      const result = yield* CallToolkit.pipe(
        Effect.flatMap((toolkit) =>
          toolkit.handle("lookup_recommended_slots", {
            zipCode: "10001",
            applianceType: "refrigerator",
          })
        ),
        Effect.flatMap(Stream.runCollect),
        Effect.map((results) => [...results][0]?.result),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(
          ServicePlatform,
          ServicePlatform.of({
            getDashboardSnapshot: Effect.die("unused"),
            getCallSession: () => Effect.die("unused"),
            bookAppointment: () => Effect.die("unused"),
            createUploadLink: () => Effect.die("unused"),
            getUploadSession: () => Effect.die("unused"),
            storeUpload: () => Effect.die("unused"),
          }),
        ),
        Effect.provideService(
          CallSessionRepo,
          CallSessionRepo.of({
            findById: () => Effect.die("unused"),
            findOption: () => Effect.die("unused"),
            createIfMissing: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            finishRun: () => Effect.die("unused"),
            clearActiveRun: () => Effect.die("unused"),
            listRecent: Effect.die("unused"),
            listRecommendedSlots: () => Effect.succeed(slots),
            listTechnicianLoad: Effect.die("unused"),
            listUploadSessions: () => Effect.die("unused"),
          }),
        ),
      );

      expect(result).toEqual(slots);
      expect(yield* readEvents(mailbox, 2)).toEqual([
        {
          _tag: "ToolStart",
          toolName: "lookup_recommended_slots",
          input: JSON.stringify({
            zipCode: "10001",
            applianceType: "refrigerator",
          }),
        },
        {
          _tag: "ToolSuccess",
          toolName: "lookup_recommended_slots",
          output: JSON.stringify(slots),
        },
      ]);
    }));

  it.effect("publishes tool failure when repository lookup fails", () =>
    Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });

      const error = yield* CallToolkit.pipe(
        Effect.flatMap((toolkit) =>
          toolkit.handle("lookup_recommended_slots", {
            zipCode: "10001",
            applianceType: "refrigerator",
          })
        ),
        Effect.flatMap(Stream.runCollect),
        Effect.exit,
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(
          ServicePlatform,
          ServicePlatform.of({
            getDashboardSnapshot: Effect.die("unused"),
            getCallSession: () => Effect.die("unused"),
            bookAppointment: () => Effect.die("unused"),
            createUploadLink: () => Effect.die("unused"),
            getUploadSession: () => Effect.die("unused"),
            storeUpload: () => Effect.die("unused"),
          }),
        ),
        Effect.provideService(
          CallSessionRepo,
          CallSessionRepo.of({
            findById: () => Effect.die("unused"),
            findOption: () => Effect.die("unused"),
            createIfMissing: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            finishRun: () => Effect.die("unused"),
            clearActiveRun: () => Effect.die("unused"),
            listRecent: Effect.die("unused"),
            listRecommendedSlots: () => Effect.die("db-down"),
            listTechnicianLoad: Effect.die("unused"),
            listUploadSessions: () => Effect.die("unused"),
          }),
        ),
      );

      expect(error._tag).toBe("Failure");
      const events = yield* readEvents(mailbox, 2);
      expect(events[0]).toEqual({
        _tag: "ToolStart",
        toolName: "lookup_recommended_slots",
        input: JSON.stringify({
          zipCode: "10001",
          applianceType: "refrigerator",
        }),
      });
      expect(events[1]).toMatchObject({
        _tag: "ToolFailure",
        toolName: "lookup_recommended_slots",
      });
      expect(events[1] && "output" in events[1] ? events[1].output : "").toContain("db-down");
    }));

  it.effect("uses the tool context session id for upload context lookups", () =>
    Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });
      const uploads = [{
        token: UploadToken.make("upload-token-1234567890"),
        status: "analyzed" as const,
        email: "pat@example.com",
        uploadUrl: "http://localhost:4173/upload/upload-token-1234567890",
        uploadedAt: "2026-05-27T12:00:00.000Z",
        analysisSummary: "Looks like dust on the condenser coils.",
        recognizedApplianceType: "refrigerator" as const,
        visibleSignals: [{
          key: "dusty-condenser-coils",
          detail: "Dusty condenser coils",
        }],
        expiresAt: "2026-05-28T12:00:00.000Z",
      }];
      const seenSessionIds: Array<typeof CallSessionId.Type> = [];

      const result = yield* CallToolkit.pipe(
        Effect.flatMap((toolkit) => toolkit.handle("lookup_upload_context", {})),
        Effect.flatMap(Stream.runCollect),
        Effect.map((results) => [...results][0]?.result),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(CallToolContext, { sessionId: SESSION_ID }),
        Effect.provideService(
          ServicePlatform,
          ServicePlatform.of({
            getDashboardSnapshot: Effect.die("unused"),
            getCallSession: () => Effect.die("unused"),
            bookAppointment: () => Effect.die("unused"),
            createUploadLink: () => Effect.die("unused"),
            getUploadSession: () => Effect.die("unused"),
            storeUpload: () => Effect.die("unused"),
          }),
        ),
        Effect.provideService(
          CallSessionRepo,
          CallSessionRepo.of({
            findById: () => Effect.die("unused"),
            findOption: () => Effect.die("unused"),
            createIfMissing: () => Effect.die("unused"),
            startRun: () => Effect.die("unused"),
            finishRun: () => Effect.die("unused"),
            clearActiveRun: () => Effect.die("unused"),
            listRecent: Effect.die("unused"),
            listRecommendedSlots: () => Effect.die("unused"),
            listTechnicianLoad: Effect.die("unused"),
            listUploadSessions: (sessionId) => {
              seenSessionIds.push(sessionId);
              return Effect.succeed(uploads);
            },
          }),
        ),
      );

      expect(result).toEqual(uploads);
      expect(seenSessionIds).toEqual([SESSION_ID]);
      expect(yield* readEvents(mailbox, 2)).toEqual([
        {
          _tag: "ToolStart",
          toolName: "lookup_upload_context",
          input: JSON.stringify({ sessionId: SESSION_ID }),
        },
        {
          _tag: "ToolSuccess",
          toolName: "lookup_upload_context",
          output: JSON.stringify(uploads),
        },
      ]);
    }));
});
