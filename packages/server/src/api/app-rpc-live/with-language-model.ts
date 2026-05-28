import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import type { LanguageModel, Response } from "effect/unstable/ai";
import { LanguageModel as LM } from "effect/unstable/ai";

interface WithLanguageModelOptions {
  readonly generateText?:
    | Array<Response.PartEncoded>
    | ((
      options: LanguageModel.ProviderOptions,
    ) => Array<Response.PartEncoded> | Effect.Effect<Array<Response.PartEncoded>>);
  readonly streamText?:
    | Array<Response.StreamPartEncoded>
    | ((
      options: LanguageModel.ProviderOptions,
    ) => Array<Response.StreamPartEncoded> | Stream.Stream<Response.StreamPartEncoded>);
}

export const withLanguageModel: {
  (
    options: WithLanguageModelOptions,
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>>;
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options: WithLanguageModelOptions,
  ): Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>>;
} = dual(
  2,
  <A, E, R>(effect: Effect.Effect<A, E, R>, options: WithLanguageModelOptions) =>
    Effect.provideServiceEffect(
      effect,
      LM.LanguageModel,
      LM.make({
        generateText: (providerOptions) => {
          if (Predicate.isUndefined(options.generateText)) {
            return Effect.succeed([]);
          }
          if (Array.isArray(options.generateText)) {
            return Effect.succeed(options.generateText);
          }
          const result = options.generateText(providerOptions);
          return Effect.isEffect(result) ? result : Effect.succeed(result);
        },
        streamText: (providerOptions) => {
          if (Predicate.isUndefined(options.streamText)) {
            return Stream.empty;
          }
          if (Array.isArray(options.streamText)) {
            return Stream.fromIterable(options.streamText);
          }
          const result = options.streamText(providerOptions);
          return Array.isArray(result) ? Stream.fromIterable(result) : result;
        },
      }),
    ),
);
