import type { TranscriptEntry as TranscriptEntryType } from "@app/domain/service-contract";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const InternalActionPayload = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optionalKey(Schema.Json),
}).annotate({ identifier: "InternalActionPayload" });

const functionActionPayload = Schema.Struct({
  function: Schema.String,
  arguments: Schema.optionalKey(Schema.Json),
});

export const decodeInternalActionPayload = (payload: unknown) =>
  Schema.decodeUnknownOption(InternalActionPayload)(payload).pipe(
    Option.orElse(() =>
      Schema.decodeUnknownOption(functionActionPayload)(payload).pipe(
        Option.map(({ function: name, arguments: payloadArguments }) =>
          payloadArguments === undefined
            ? { name }
            : { name, arguments: payloadArguments }
        ),
      )
    ),
  );

const internalActionFallbackText = (
  actionPayload: typeof InternalActionPayload.Type,
) => {
  if (actionPayload.name === "greet") {
    const callerName = Schema.decodeUnknownOption(Schema.Struct({ callerName: Schema.String }))(
      actionPayload.arguments,
    ).pipe(
      Option.map(({ callerName }) => callerName.trim()),
      Option.filter((name) => name.length > 0),
      Option.getOrUndefined,
    );

    return callerName === undefined
      ? "Hello. How can I help with your appliance today?"
      : `Hello ${callerName}. How can I help with your appliance today?`;
  }

  return "I’m gathering a few details so I can help with your appliance issue.";
};

export const normalizeAssistantReplyText = (assistantMessage: string) => {
  const trimmedAssistantMessage = assistantMessage.trim();

  try {
    const parsedAssistantMessage = JSON.parse(trimmedAssistantMessage);
    if (typeof parsedAssistantMessage === "string") {
      return parsedAssistantMessage.trim();
    }

    return decodeInternalActionPayload(parsedAssistantMessage).pipe(
      Option.map(internalActionFallbackText),
      Option.getOrElse(() => trimmedAssistantMessage),
    );
  } catch {
    return trimmedAssistantMessage;
  }
};

export const normalizeZipCode = (zipCode: string | null) => {
  if (zipCode === null) {
    return null;
  }

  const normalizedZipCode = zipCode.trim().match(/\d{5}(?:-\d{4})?/);
  return normalizedZipCode === null ? zipCode.trim() : normalizedZipCode[0];
};

export const normalizeTranscript = (
  transcript: ReadonlyArray<TranscriptEntryType>,
): ReadonlyArray<TranscriptEntryType> =>
  Arr.map(
    transcript,
    (entry) =>
      entry.role !== "assistant"
        ? entry
        : {
          ...entry,
          message: normalizeAssistantReplyText(entry.message),
        },
  );
