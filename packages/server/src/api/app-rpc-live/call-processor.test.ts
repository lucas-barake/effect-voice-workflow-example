import {
  AppointmentId,
  CallRunEvent,
  CallSessionId,
  SlotId,
  TechnicianId,
} from "@app/domain/service-contract";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import type * as Take from "effect/Take";
import { CallProcessor } from "./call-processor.js";
import { CallSessionModel } from "./call-session-model.js";
import { CallSessionRepo } from "./call-session-repo.js";
import { CallToolkitLive } from "./call-toolkit-live.js";
import { CallMailbox, CallToolContext } from "./call-toolkit.js";
import { ServicePlatform } from "./service-platform.js";
import { withLanguageModel } from "./with-language-model.js";

const SESSION_ID = CallSessionId.make("40000000-0000-4000-8000-000000000031");

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

const unusedServicePlatform = ServicePlatform.of({
  getDashboardSnapshot: Effect.die("unused"),
  getCallSession: () => Effect.die("unused"),
  bookAppointment: () => Effect.die("unused"),
  createUploadLink: () => Effect.die("unused"),
  getUploadSession: () => Effect.die("unused"),
  storeUpload: () => Effect.die("unused"),
});

describe("CallProcessor", () => {
  it.effect("streams assistant text, publishes chunk events, and returns the updated session state", () =>
    Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });
      const result = yield* CallProcessor.pipe(
        Effect.flatMap((processor) =>
          processor.run(makeSession(), {
            sessionId: SESSION_ID,
            customerName: "Pat Doe",
            phoneNumber: "+15550100",
            email: "pat@example.com",
            zipCode: "10001",
            utterance: "My refrigerator is warm.",
          })
        ),
        Effect.provide(CallProcessor.layer),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(CallToolContext, { sessionId: SESSION_ID }),
        Effect.provideService(ServicePlatform, unusedServicePlatform),
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
            listUploadSessions: () => Effect.die("unused"),
          }),
        ),
      );

      const events = yield* Stream.fromPubSubTake(mailbox).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.map((chunks) => [...chunks]),
      );

      expect(result.assistantMessage).toBe("Please check the condenser coils.");
      expect(result.applianceType).toBe("refrigerator");
      expect(result.status).toBe("troubleshooting");
      expect(result.nextSteps).toEqual([{
        key: "check-condenser-coils",
        instruction: "Please check the condenser coils.",
        completionHint: "Tell me whether the coils are dusty.",
      }]);
      expect(result.transcript.map(({ role, message }) => ({ role, message }))).toEqual([
        {
          role: "caller",
          message: "My refrigerator is warm.",
        },
        {
          role: "assistant",
          message: "Please check the condenser coils.",
        },
      ]);
      expect(events).toEqual([{
        _tag: "Chunk",
        delta: "Please check the condenser coils.",
      }]);
    }).pipe(
      withLanguageModel({
        streamText: [
          {
            type: "text-delta",
            id: "assistant-message",
            delta: "Please check the condenser coils.",
          },
          {
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: {
                uncached: 12,
                total: 12,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: 8,
                text: 8,
                reasoning: 0,
              },
            },
            response: undefined,
          },
        ],
        generateText: [{
          type: "text",
          text: JSON.stringify({
            customerName: "Pat Doe",
            applianceType: "refrigerator",
            zipCode: "10001",
            status: "troubleshooting",
            symptomSummary: [{
              key: "warm-fridge",
              detail: "The refrigerator compartment is warm.",
            }],
            nextSteps: [{
              key: "check-condenser-coils",
              instruction: "Please check the condenser coils.",
              completionHint: "Tell me whether the coils are dusty.",
            }],
          }),
        }],
      }),
    ));

  it.effect("rewrites internal action payload text into a natural caller response", () => {
    let generateTextCallCount = 0;

    return Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });
      const result = yield* CallProcessor.pipe(
        Effect.flatMap((processor) =>
          processor.run(makeSession(), {
            sessionId: SESSION_ID,
            customerName: "Pat Jordan",
            phoneNumber: "+15550199",
            email: "pat@example.com",
            zipCode: "60601",
            utterance: "My refrigerator is warm and making a buzzing noise.",
          })
        ),
        Effect.provide(CallProcessor.layer),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(CallToolContext, { sessionId: SESSION_ID }),
        Effect.provideService(ServicePlatform, unusedServicePlatform),
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
            listUploadSessions: () => Effect.die("unused"),
          }),
        ),
      );

      expect(result.assistantMessage).toBe(
        "Hi Pat Jordan, I can help with your refrigerator. Tell me whether it is still cooling at all.",
      );
      expect(result.zipCode).toBe("60601");
      expect(result.transcript.map(({ role, message }) => ({ role, message }))).toEqual([
        {
          role: "caller",
          message: "My refrigerator is warm and making a buzzing noise.",
        },
        {
          role: "assistant",
          message:
            "Hi Pat Jordan, I can help with your refrigerator. Tell me whether it is still cooling at all.",
        },
      ]);
      expect(generateTextCallCount).toBe(2);
    }).pipe(
      withLanguageModel({
        streamText: [
          {
            type: "text-delta",
            id: "assistant-message",
            delta:
              "{\"function\":\"triage_appliance\",\"arguments\":{\"symptoms\":[\"warm\",\"buzzing\"]}}",
          },
          {
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: {
                uncached: 12,
                total: 12,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: 8,
                text: 8,
                reasoning: 0,
              },
            },
            response: undefined,
          },
        ],
        generateText: () => {
          generateTextCallCount += 1;
          return generateTextCallCount === 1
            ? [{
              type: "text",
              text:
                "\"Hi Pat Jordan, I can help with your refrigerator. Tell me whether it is still cooling at all.\"",
            }]
            : [{
              type: "text",
              text: JSON.stringify({
                customerName: "Pat Jordan",
                applianceType: "refrigerator",
                zipCode: "Why is your refrigerator warm and making a buzzing noise?",
                status: "diagnosing",
                symptomSummary: [{
                  key: "warm-fridge",
                  detail: "The refrigerator is warm and making a buzzing noise.",
                }],
                nextSteps: [],
              }),
            }];
        },
      }),
    );
  });

  it.effect("books an accepted slot, marks the session scheduled, and confirms the appointment in the reply", () => {
    let streamTextCallCount = 0;

    return Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });

      const result = yield* CallProcessor.pipe(
        Effect.flatMap((processor) =>
          processor.run(
            makeSession({
              applianceType: "refrigerator",
              status: "ready_to_schedule",
              nextSteps: [{
                key: "offer-visit",
                instruction: "Offer the caller an available technician visit.",
                completionHint: "Ask which appointment window works best.",
              }],
            }),
            {
              sessionId: SESSION_ID,
              customerName: "Pat Jordan",
              phoneNumber: "+15550199",
              email: "pat@example.com",
              zipCode: "60601",
              utterance: "The Friday afternoon visit works for me. Please book it.",
            },
          )
        ),
        Effect.provide(CallProcessor.layer),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(CallToolContext, { sessionId: SESSION_ID }),
        Effect.provideService(
          ServicePlatform,
          ServicePlatform.of({
            ...unusedServicePlatform,
            bookAppointment: () =>
              Effect.succeed({
                appointment: {
                  id: AppointmentId.make("50000000-0000-4000-8000-000000000081"),
                  slotId: SlotId.make("50000000-0000-4000-8000-000000000082"),
                  technicianId: TechnicianId.make("50000000-0000-4000-8000-000000000083"),
                  technicianName: "Jordan Price",
                  startsAt: "2026-05-29T19:00:00.000Z",
                  endsAt: "2026-05-29T21:00:00.000Z",
                  applianceType: "refrigerator",
                  zipCode: "60601",
                  confirmationCode: "svc-19af02",
                },
                session: {
                  id: SESSION_ID,
                  activeRunId: null,
                  customerName: "Pat Jordan",
                  phoneNumber: "+15550199",
                  email: "pat@example.com",
                  zipCode: "60601",
                  applianceType: "refrigerator",
                  status: "scheduled",
                  symptomSummary: [],
                  transcript: [],
                  nextSteps: [],
                  recommendedSlots: [],
                  appointment: {
                    id: AppointmentId.make("50000000-0000-4000-8000-000000000081"),
                    slotId: SlotId.make("50000000-0000-4000-8000-000000000082"),
                    technicianId: TechnicianId.make("50000000-0000-4000-8000-000000000083"),
                    technicianName: "Jordan Price",
                    startsAt: "2026-05-29T19:00:00.000Z",
                    endsAt: "2026-05-29T21:00:00.000Z",
                    applianceType: "refrigerator",
                    zipCode: "60601",
                    confirmationCode: "svc-19af02",
                  },
                  uploadSessions: [],
                  updatedAt: "2026-05-27T12:00:00.000Z",
                },
              }),
          }),
        ),
        Effect.provideService(
          CallSessionRepo,
          CallSessionRepo.of({
            findById: () =>
              Effect.succeed(makeSession({
                applianceType: "refrigerator",
                status: "ready_to_schedule",
              })),
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
        ),
      );

      expect(result.status).toBe("scheduled");
      expect(result.nextSteps).toEqual([]);
      expect(result.assistantMessage).toBe(
        "I have you booked with Jordan Price for Friday from 2 PM to 4 PM. Your confirmation code is svc-19af02.",
      );
      expect(result.transcript.map(({ role, message }) => ({ role, message }))).toEqual([
        {
          role: "caller",
          message: "The Friday afternoon visit works for me. Please book it.",
        },
        {
          role: "tool",
          message:
            "book_appointment: {\"id\":\"50000000-0000-4000-8000-000000000081\",\"slotId\":\"50000000-0000-4000-8000-000000000082\",\"technicianId\":\"50000000-0000-4000-8000-000000000083\",\"technicianName\":\"Jordan Price\",\"startsAt\":\"2026-05-29T19:00:00.000Z\",\"endsAt\":\"2026-05-29T21:00:00.000Z\",\"applianceType\":\"refrigerator\",\"zipCode\":\"60601\",\"confirmationCode\":\"svc-19af02\"}",
        },
        {
          role: "assistant",
          message:
            "I have you booked with Jordan Price for Friday from 2 PM to 4 PM. Your confirmation code is svc-19af02.",
        },
      ]);
      expect(streamTextCallCount).toBe(2);
    }).pipe(
      withLanguageModel({
        streamText: () => {
          streamTextCallCount += 1;
          return streamTextCallCount === 1
            ? [
              {
                type: "tool-call",
                id: "tool-1",
                name: "book_appointment",
                params: {
                  slotId: "50000000-0000-4000-8000-000000000082",
                },
              },
              {
                type: "finish",
                reason: "tool-calls",
                usage: {
                  inputTokens: {
                    uncached: 12,
                    total: 12,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 8,
                    text: 0,
                    reasoning: 0,
                  },
                },
                response: undefined,
              },
            ]
            : [
              {
                type: "text-delta",
                id: "assistant-message",
                delta:
                  "I have you booked with Jordan Price for Friday from 2 PM to 4 PM. Your confirmation code is svc-19af02.",
              },
              {
                type: "finish",
                reason: "stop",
                usage: {
                  inputTokens: {
                    uncached: 12,
                    total: 12,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 8,
                    text: 8,
                    reasoning: 0,
                  },
                },
                response: undefined,
              },
            ];
        },
        generateText: [{
          type: "text",
          text: JSON.stringify({
            customerName: "Pat Jordan",
            applianceType: "refrigerator",
            zipCode: "60601",
            status: "scheduled",
            symptomSummary: [{
              key: "warm-fridge",
              detail: "The refrigerator is still warm.",
            }],
            nextSteps: [{
              key: "appointment-booked",
              instruction: "Appointment confirmed.",
              completionHint: "Repeat the confirmation details to the caller.",
            }],
          }),
        }],
      }),
    );
  });

  it.effect("tells the repair prompt not to ask for known zip code details again", () => {
    let generateTextCallCount = 0;

    return Effect.gen(function*() {
      const mailbox = yield* PubSub.unbounded<Take.Take<typeof CallRunEvent.Type>>({
        replay: Infinity,
      });

      const result = yield* CallProcessor.pipe(
        Effect.flatMap((processor) =>
          processor.run(
            makeSession({
              applianceType: "refrigerator",
            }),
            {
              sessionId: SESSION_ID,
              customerName: "Pat Jordan",
              phoneNumber: "+15550199",
              email: "pat@example.com",
              zipCode: "60601",
              utterance:
                "It is still warm, and I hear the buzzing every few minutes. Can you send me a photo link so I can show the inside panel?",
            },
          )
        ),
        Effect.provide(CallProcessor.layer),
        Effect.provide(CallToolkitLive),
        Effect.provideService(CallMailbox, mailbox),
        Effect.provideService(CallToolContext, { sessionId: SESSION_ID }),
        Effect.provideService(ServicePlatform, unusedServicePlatform),
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
            listUploadSessions: () => Effect.die("unused"),
          }),
        ),
      );

      expect(result.assistantMessage).toBe(
        "I can send a secure photo upload link to your email now so you can show me the inside panel.",
      );
      expect(result.transcript.at(-1)?.message).toBe(
        "I can send a secure photo upload link to your email now so you can show me the inside panel.",
      );
      expect(generateTextCallCount).toBe(2);
    }).pipe(
      withLanguageModel({
        streamText: [
          {
            type: "text-delta",
            id: "assistant-message",
            delta:
              "{\"function\":\"lookup_upload_context\",\"arguments\":{\"reason\":\"photo request\"}}",
          },
          {
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: {
                uncached: 12,
                total: 12,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: 8,
                text: 8,
                reasoning: 0,
              },
            },
            response: undefined,
          },
        ],
        generateText: (providerOptions) => {
          generateTextCallCount += 1;
          if (generateTextCallCount === 1) {
            const promptText = JSON.stringify(
              providerOptions,
              (_key, value) => typeof value === "bigint" ? value.toString() : value,
            );
            return [{
              type: "text",
              text: promptText.includes(
                  "Do not ask for the zip code, email, phone number, or customer name again when already known below.",
                )
                ? "\"I can send a secure photo upload link to your email now so you can show me the inside panel.\""
                : "\"Can you please provide me with the zip code on the back of your appliance so I can help you further?\"",
            }];
          }

          return [{
            type: "text",
            text: JSON.stringify({
              customerName: "Pat Jordan",
              applianceType: "refrigerator",
              zipCode: "60601",
              status: "awaiting_upload",
              symptomSummary: [{
                key: "warm-fridge",
                detail: "The refrigerator is warm and making a buzzing noise.",
              }],
              nextSteps: [{
                key: "await-photo-upload",
                instruction: "Send the secure photo upload link and review the uploaded photo.",
                completionHint: "Wait for the photo upload before final scheduling.",
              }],
            }),
          }];
        },
      }),
    );
  });
});
