import {
  ApplianceType,
  GuidanceStep,
  SessionStatus,
  TroubleSignal,
} from "@app/domain/service-contract";
import type {
  StartCallRunInput as StartCallRunInputType,
  TranscriptEntry as TranscriptEntryType,
} from "@app/domain/service-contract";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { LanguageModel } from "effect/unstable/ai";
import * as AiChat from "effect/unstable/ai/Chat";
import * as Prompt from "effect/unstable/ai/Prompt";
import type * as Response from "effect/unstable/ai/Response";
import { CallSessionModel } from "./call-session-model.js";
import {
  decodeInternalActionPayload,
  InternalActionPayload,
  normalizeAssistantReplyText,
  normalizeZipCode,
} from "./call-session-normalization.js";
import { CallMailbox, CallToolkit } from "./call-toolkit.js";

const TurnSessionDraft = Schema.Struct({
  customerName: Schema.String,
  applianceType: Schema.NullOr(ApplianceType),
  zipCode: Schema.NullOr(Schema.String),
  status: SessionStatus,
  symptomSummary: Schema.Array(TroubleSignal),
  nextSteps: Schema.Array(GuidanceStep),
}).annotate({ identifier: "TurnSessionDraft" });

const transcriptMessage = (
  role: TranscriptEntryType["role"],
  message: string,
) =>
  Effect.map(DateTime.now, (at): TranscriptEntryType => ({
    role,
    message,
    at: DateTime.formatIso(at),
  }));

const systemInstructions = [
  "You are the voice agent for a household appliance repair operations team.",
  "Your job is to triage the issue, ask only the next necessary question, use tools when live operational data matters, and move the caller toward troubleshooting, upload collection, or scheduling.",
  "Be concise and natural for a phone conversation.",
  "Do not mention internal tooling.",
  "Do not ask for the customer name, phone number, email, or zip code again when those details are already known in the session context.",
  "If the caller asks for a photo upload link and the email is already known, acknowledge that a secure upload link can be sent.",
  "Only ask for missing information when it is truly required for the very next step.",
].join("\n");

const internalActionToReplyPrompt = ({
  session,
  utterance,
  actionPayload,
}: {
  readonly session: typeof CallSessionModel.Type;
  readonly utterance: string;
  readonly actionPayload: typeof InternalActionPayload.Type;
}) =>
  [
    "You are fixing a malformed voice-agent turn.",
    "An internal action payload was produced instead of the spoken assistant reply.",
    "Write only the exact caller-facing sentence the assistant should say next.",
    "Be concise, natural, and suitable for a phone conversation.",
    "Do not mention JSON, schemas, actions, tools, or internal systems.",
    "Do not ask for the zip code, email, phone number, or customer name again when already known below.",
    "If zip_code is known, do not ask the caller to repeat it.",
    "If the caller asked for a photo upload link and email is known, acknowledge that a secure upload link can be sent.",
    `customer_name=${session.customerName}`,
    `phone_number=${session.phoneNumber}`,
    `email=${session.email ?? "unknown"}`,
    `zip_code=${session.zipCode ?? "unknown"}`,
    `appliance_type=${session.applianceType ?? "unknown"}`,
    `session_status=${session.status}`,
    `symptom_summary=${JSON.stringify(session.symptomSummary)}`,
    `caller_utterance=${utterance}`,
    `internal_action_payload=${JSON.stringify(actionPayload)}`,
  ].join("\n");

const initialFinishReason = "stop" satisfies Response.FinishReason;

const transcriptPromptEntry = (entry: TranscriptEntryType) =>
  entry.role === "tool"
    ? []
    : [{
      role: entry.role === "caller" ? "user" : "assistant",
      content: entry.message,
    }] satisfies ReadonlyArray<{
      readonly role: "user" | "assistant";
      readonly content: string;
    }>;

const makeConversationPrompt = ({
  session,
  utterance,
}: {
  readonly session: typeof CallSessionModel.Type;
  readonly utterance: string;
}) =>
  Prompt.make([
    {
      role: "system",
      content: [
        systemInstructions,
        `Known customer name: ${session.customerName}`,
        `Known phone number: ${session.phoneNumber}`,
        `Known email: ${session.email ?? "unknown"}`,
        `Known zip code: ${session.zipCode ?? "unknown"}`,
        `Known appliance: ${session.applianceType ?? "unknown"}`,
        `Current status: ${session.status}`,
        `Known symptoms: ${JSON.stringify(session.symptomSummary)}`,
        `Current next steps: ${JSON.stringify(session.nextSteps)}`,
      ].join("\n"),
    },
    ...session.transcript.flatMap(transcriptPromptEntry),
    {
      role: "user",
      content: utterance,
    },
  ]);

const makeStatePrompt = ({
  session,
  input,
  assistantMessage,
}: {
  readonly session: typeof CallSessionModel.Type;
  readonly input: StartCallRunInputType;
  readonly assistantMessage: string;
}) =>
  [
    "Return only structured output.",
    "Update the service session state after the latest phone turn.",
    "Status rules:",
    "intake when appliance or issue is still unclear.",
    "diagnosing when the appliance is known but the failure mode is still being narrowed.",
    "troubleshooting when you can give actionable steps to try now.",
    "ready_to_schedule when a technician visit is the best next step.",
    "resolved only when the caller clearly says the issue is fixed.",
    "scheduled and awaiting_upload are reserved for downstream actions and should not be emitted here.",
    `existing_customer_name=${session.customerName}`,
    `existing_email=${session.email ?? "unknown"}`,
    `existing_zip_code=${session.zipCode ?? "unknown"}`,
    `existing_appliance=${session.applianceType ?? "unknown"}`,
    `existing_status=${session.status}`,
    `existing_symptoms=${JSON.stringify(session.symptomSummary)}`,
    `existing_transcript=${JSON.stringify(session.transcript)}`,
    `turn_customer_name=${input.customerName ?? "unknown"}`,
    `turn_phone_number=${input.phoneNumber ?? "unknown"}`,
    `turn_email=${input.email ?? "unknown"}`,
    `turn_zip_code=${input.zipCode ?? "unknown"}`,
    `caller_utterance=${input.utterance}`,
    `assistant_message=${assistantMessage}`,
  ].join("\n");

const repairAssistantMessage = ({
  session,
  input,
  assistantMessage,
}: {
  readonly session: typeof CallSessionModel.Type;
  readonly input: StartCallRunInputType;
  readonly assistantMessage: string;
}) =>
  Option.match(
    (() => {
      try {
        return decodeInternalActionPayload(JSON.parse(assistantMessage));
      } catch {
        return Option.none();
      }
    })(),
    {
      onNone: () => Effect.succeed(assistantMessage),
      onSome: (actionPayload) =>
        LanguageModel.generateText({
          prompt: internalActionToReplyPrompt({
            session,
            utterance: input.utterance,
            actionPayload,
          }),
        }).pipe(
          Effect.map((response) => normalizeAssistantReplyText(response.text)),
          Effect.map((responseText) => responseText.length === 0 ? assistantMessage : responseText),
        ),
    },
  );

const resolveZipCode = ({
  stateZipCode,
  inputZipCode,
  sessionZipCode,
}: {
  readonly stateZipCode: string | null;
  readonly inputZipCode: string | null;
  readonly sessionZipCode: string | null;
}) => {
  const normalizedStateZipCode = normalizeZipCode(stateZipCode);
  if (normalizedStateZipCode !== null && /\d{5}(?:-\d{4})?/.test(normalizedStateZipCode)) {
    return normalizedStateZipCode;
  }

  const normalizedInputZipCode = normalizeZipCode(inputZipCode);
  if (normalizedInputZipCode !== null && /\d{5}(?:-\d{4})?/.test(normalizedInputZipCode)) {
    return normalizedInputZipCode;
  }

  const normalizedSessionZipCode = normalizeZipCode(sessionZipCode);
  return normalizedSessionZipCode !== null && /\d{5}(?:-\d{4})?/.test(normalizedSessionZipCode)
    ? normalizedSessionZipCode
    : normalizedStateZipCode;
};

export class CallProcessor extends Context.Service<CallProcessor>()("CallProcessor", {
  make: Effect.succeed({
    run: Effect.fnUntraced(
      function*(session: typeof CallSessionModel.Type, input: StartCallRunInputType) {
        const mailbox = yield* CallMailbox;
        const toolkit = yield* CallToolkit;
        const chat = yield* AiChat.fromPrompt(
          makeConversationPrompt({ session, utterance: input.utterance }),
        );

        let assistantMessage = "";
        const toolTranscript: TranscriptEntryType[] = [];
        let continueLoop = true;

        while (continueLoop) {
          const result = yield* chat.streamText({
            prompt: Prompt.empty,
            toolkit,
          }).pipe(
            Stream.runFoldEffect(
              () => ({
                finish: initialFinishReason,
                textSoFar: "",
                toolResults: Arr.empty<{
                  readonly name: string;
                  readonly result: Schema.Json;
                  readonly isFailure: boolean;
                }>(),
              }),
              Effect.fnUntraced(function*(acc, part) {
                switch (part.type) {
                  case "text-delta":
                    yield* PubSub.publish(mailbox, [{ _tag: "Chunk", delta: part.delta }]);
                    return { ...acc, textSoFar: acc.textSoFar + part.delta };
                  case "reasoning-delta":
                    yield* PubSub.publish(mailbox, [{ _tag: "ReasoningChunk", delta: part.delta }]);
                    return acc;
                  case "tool-result":
                    return {
                      ...acc,
                      toolResults: [
                        ...acc.toolResults,
                        {
                          name: part.name,
                          result: part.result,
                          isFailure: part.isFailure,
                        },
                      ],
                    };
                  case "finish":
                    return { ...acc, finish: part.reason };
                  case "error":
                  case "file":
                  case "reasoning-end":
                  case "reasoning-start":
                  case "response-metadata":
                  case "source":
                  case "text-end":
                  case "text-start":
                  case "tool-approval-request":
                  case "tool-call":
                  case "tool-params-delta":
                  case "tool-params-end":
                  case "tool-params-start":
                    return acc;
                  default:
                    return acc;
                }
              }),
            ),
          );

          assistantMessage = `${assistantMessage}${result.textSoFar}`;
          for (const toolResult of result.toolResults) {
            toolTranscript.push(
              yield* transcriptMessage(
                "tool",
                `${toolResult.name}: ${
                  typeof toolResult.result === "string"
                    ? toolResult.result
                    : JSON.stringify(toolResult.result)
                }`,
              ),
            );
          }
          continueLoop = result.finish === "tool-calls";
        }

        assistantMessage = yield* repairAssistantMessage({
          session,
          input,
          assistantMessage,
        });
        assistantMessage = normalizeAssistantReplyText(assistantMessage);

        const state = yield* LanguageModel.generateObject({
          prompt: makeStatePrompt({
            session,
            input,
            assistantMessage,
          }),
          schema: TurnSessionDraft,
        }).pipe(
          Effect.map((result) => result.value),
        );

        return {
          customerName: state.customerName,
          phoneNumber: input.phoneNumber ?? session.phoneNumber,
          email: input.email ?? session.email,
          zipCode: resolveZipCode({
            stateZipCode: state.zipCode,
            inputZipCode: input.zipCode ?? null,
            sessionZipCode: session.zipCode,
          }),
          applianceType: state.applianceType,
          status: state.status,
          symptomSummary: state.symptomSummary,
          nextSteps: state.nextSteps,
          assistantMessage,
          transcript: [
            ...session.transcript,
            yield* transcriptMessage("caller", input.utterance),
            ...toolTranscript,
            yield* transcriptMessage("assistant", assistantMessage),
          ],
        };
      },
    ),
  }),
}) {
  static layer: Layer.Layer<CallProcessor> = Layer.effect(this, this.make);
}
