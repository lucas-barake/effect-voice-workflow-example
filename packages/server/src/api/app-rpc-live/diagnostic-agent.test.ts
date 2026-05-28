import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { LanguageModel as LM } from "effect/unstable/ai";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { AiModels } from "./ai-models.js";
import { DiagnosticAgent } from "./diagnostic-agent.js";

describe("DiagnosticAgent", () => {
  it.effect("plans a turn with structured output and appends caller plus assistant transcript", () => {
    const languageModel = LM.make({
      generateText: () =>
        Effect.succeed([{
          type: "text",
          text: JSON.stringify({
            customerName: "Pat Jordan",
            applianceType: "refrigerator",
            zipCode: "60601",
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
            assistantMessage: "Please check the condenser coils.",
          }),
        }]),
      streamText: () => Stream.empty,
    });

    return Effect.gen(function*() {
      const agent = yield* DiagnosticAgent;
      const result = yield* agent.planTurn(
        {
          sessionId: null,
          customerName: "Pat Jordan",
          phoneNumber: "+1-555-0199",
          email: "pat@example.com",
          zipCode: "60601",
          utterance: "My refrigerator is warm and making a buzzing noise.",
        },
        {
          customerName: "Pat Jordan",
          applianceType: null,
          zipCode: "60601",
          symptomSummary: [],
          transcript: [{
            role: "assistant",
            message: "Tell me what appliance is having trouble.",
            at: "2026-05-26T12:00:00.000Z",
          }],
        },
        2,
      );

      expect(result.customerName).toBe("Pat Jordan");
      expect(result.applianceType).toBe("refrigerator");
      expect(result.status).toBe("troubleshooting");
      expect(result.nextSteps).toEqual([{
        key: "check-condenser-coils",
        instruction: "Please check the condenser coils.",
        completionHint: "Tell me whether the coils are dusty.",
      }]);
      expect(result.transcript.map(({ role, message }) => ({ role, message }))).toEqual([
        {
          role: "assistant",
          message: "Tell me what appliance is having trouble.",
        },
        {
          role: "caller",
          message: "My refrigerator is warm and making a buzzing noise.",
        },
        {
          role: "assistant",
          message: "Please check the condenser coils.",
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.effect(DiagnosticAgent, DiagnosticAgent.make).pipe(
          Layer.provide(Layer.succeed(
            AiModels,
            AiModels.of({
              use: () => (self) =>
                Effect.provideServiceEffect(self, LanguageModel.LanguageModel, languageModel),
              layer: () => Layer.effect(LanguageModel.LanguageModel, languageModel),
            }),
          )),
        ),
      ),
    );
  });
});
