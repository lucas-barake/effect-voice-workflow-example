import {
  ApplianceType,
  GuidanceStep,
  SessionStatus,
  SimulateCallTurnInput,
  TranscriptEntry,
  TroubleSignal,
} from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { LanguageModel } from "effect/unstable/ai";
import * as AiError from "effect/unstable/ai/AiError";
import { AiModels } from "./ai-models.js";

const PlanTurnDraft = Schema.Struct({
  customerName: Schema.String,
  applianceType: Schema.NullOr(ApplianceType),
  zipCode: Schema.NullOr(Schema.String),
  status: SessionStatus,
  symptomSummary: Schema.Array(TroubleSignal),
  nextSteps: Schema.Array(GuidanceStep),
  assistantMessage: Schema.String,
});

const transcriptMessage = (role: "caller" | "assistant", message: string) =>
  Effect.map(DateTime.now, (at): TranscriptEntry => ({
    role,
    message,
    at: DateTime.formatIso(at),
  }));

const renderPrompt = (input: {
  readonly turn: SimulateCallTurnInput;
  readonly existing: {
    readonly customerName: string;
    readonly applianceType: ApplianceType | null;
    readonly zipCode: string | null;
    readonly symptomSummary: ReadonlyArray<TroubleSignal>;
    readonly transcript: ReadonlyArray<TranscriptEntry>;
  } | null;
  readonly recommendedSlotCount: number;
}) =>
  [
    "You are a service operations triage planner for a home appliance repair team.",
    "Return only valid structured output for the provided schema.",
    "Use these status rules:",
    "intake when appliance or issue is still unclear.",
    "diagnosing when the appliance is known but the failure mode is still being narrowed.",
    "troubleshooting when you can give actionable steps to try now.",
    "ready_to_schedule when a technician visit is the best next step and matching slots exist.",
    "resolved only when the caller clearly says the issue is fixed.",
    "scheduled and awaiting_upload are reserved for later system actions and should not be emitted here.",
    `recommended_slot_count=${String(input.recommendedSlotCount)}`,
    `existing_customer_name=${input.existing?.customerName ?? "unknown"}`,
    `existing_appliance=${input.existing?.applianceType ?? "unknown"}`,
    `existing_zip_code=${input.existing?.zipCode ?? "unknown"}`,
    `existing_symptoms=${JSON.stringify(input.existing?.symptomSummary ?? [])}`,
    `existing_transcript=${JSON.stringify(input.existing?.transcript ?? [])}`,
    `turn_customer_name=${input.turn.customerName ?? "unknown"}`,
    `turn_phone_number=${input.turn.phoneNumber ?? "unknown"}`,
    `turn_email=${input.turn.email ?? "unknown"}`,
    `turn_zip_code=${input.turn.zipCode ?? "unknown"}`,
    `caller_utterance=${input.turn.utterance}`,
    "Infer appliance type when possible from the utterance.",
    "Keep nextSteps short and concrete. Prefer two steps or fewer.",
    "When no strong step is available, return an empty nextSteps array.",
  ].join("\n");

export class DiagnosticAgent extends Context.Service<DiagnosticAgent, {
  readonly planTurn: (
    input: SimulateCallTurnInput,
    existing: {
      readonly customerName: string;
      readonly applianceType: ApplianceType | null;
      readonly zipCode: string | null;
      readonly symptomSummary: ReadonlyArray<TroubleSignal>;
      readonly transcript: ReadonlyArray<TranscriptEntry>;
    } | null,
    recommendedSlotCount: number,
  ) => Effect.Effect<{
    readonly customerName: string;
    readonly applianceType: ApplianceType | null;
    readonly zipCode: string | null;
    readonly status: SessionStatus;
    readonly symptomSummary: ReadonlyArray<TroubleSignal>;
    readonly nextSteps: ReadonlyArray<GuidanceStep>;
    readonly assistantMessage: string;
    readonly transcript: ReadonlyArray<TranscriptEntry>;
  }, AiError.AiError>;
}>()("DiagnosticAgent") {
  static make = Effect.gen(function*() {
    const aiModels = yield* AiModels;
    return DiagnosticAgent.of({
      planTurn: (input, existing, recommendedSlotCount) =>
        LanguageModel.generateObject({
          prompt: renderPrompt({
            turn: input,
            existing,
            recommendedSlotCount,
          }),
          schema: PlanTurnDraft,
        }).pipe(
          aiModels.use("chat"),
          Effect.andThen((draft) =>
            Effect.all([
              transcriptMessage("caller", input.utterance),
              transcriptMessage("assistant", draft.value.assistantMessage),
            ]).pipe(
              Effect.map(([callerTranscript, assistantTranscript]) => ({
                ...draft.value,
                transcript: [
                  ...(existing?.transcript ?? []),
                  callerTranscript,
                  assistantTranscript,
                ],
              })),
            )
          ),
        ),
    });
  });

  static layer = Layer.effect(this, this.make).pipe(Layer.provide(AiModels.layer));
}
