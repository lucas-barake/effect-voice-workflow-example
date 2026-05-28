import { AppConfig } from "@/config.js";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as LanguageModel from "effect/unstable/ai/LanguageModel";

type ModelFamily = "chat" | "vision";

const chatModelName = "llama3.2";
const visionModelName = "llama3.2-vision";

const AiProviderLive = Layer.unwrap(
  Effect.gen(function*() {
    const config = yield* AppConfig;
    return OpenAiClient.layer({
      apiUrl: config.localLlmApiUrl,
      apiKey: config.localLlmApiKey === null ? undefined : Redacted.make(config.localLlmApiKey),
    }).pipe(Layer.provide(NodeHttpClient.layerUndici));
  }),
);

export class AiModels extends Context.Service<AiModels, {
  readonly use: (
    model: ModelFamily,
  ) => <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, LanguageModel.LanguageModel>>;
  readonly layer: (model: ModelFamily) => Layer.Layer<LanguageModel.LanguageModel>;
}>()("@app/api/app-rpc-live/AiModels") {
  static readonly layer: Layer.Layer<AiModels, never, AppConfig> = Layer.effect(
    this,
    Effect.gen(function*() {
      yield* AppConfig;
      const chatModel = yield* OpenAiLanguageModel.model(chatModelName).captureRequirements;
      const visionModel = yield* OpenAiLanguageModel.model(visionModelName)
        .captureRequirements;

      const getModelLayer = (model: ModelFamily): Layer.Layer<LanguageModel.LanguageModel> => {
        switch (model) {
          case "chat":
            return chatModel;
          case "vision":
            return visionModel;
        }
      };

      return {
        use: (model) => (self) => Effect.provide(self, getModelLayer(model)),
        layer: getModelLayer,
      };
    }),
  ).pipe(Layer.provide(AiProviderLive), Layer.orDie);
}
