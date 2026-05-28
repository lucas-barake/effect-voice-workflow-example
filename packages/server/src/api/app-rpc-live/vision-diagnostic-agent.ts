import type { ApplianceType, TroubleSignal } from "@app/domain/service-contract";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { LanguageModel } from "effect/unstable/ai";
import * as AiError from "effect/unstable/ai/AiError";
import * as Prompt from "effect/unstable/ai/Prompt";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { AiModels } from "./ai-models.js";

const VisionDraft = Schema.Struct({
  recognizedApplianceType: Schema.NullOr(
    Schema.Literals(["washer", "dryer", "refrigerator", "dishwasher", "oven", "hvac"]),
  ),
  analysisSummary: Schema.String,
  visibleSignals: Schema.Array(Schema.Struct({
    key: Schema.String,
    detail: Schema.String,
  })),
});

const mediaTypeFromPath = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    default:
      return "image/jpeg";
  }
};

export class VisionDiagnosticAgent extends Context.Service<VisionDiagnosticAgent, {
  readonly analyzeUpload: (
    input: {
      readonly applianceType: ApplianceType | null;
      readonly filePath: string;
      readonly fileName: string;
    },
  ) => Effect.Effect<{
    readonly recognizedApplianceType: ApplianceType | null;
    readonly analysisSummary: string;
    readonly visibleSignals: ReadonlyArray<TroubleSignal>;
  }, AiError.AiError | Error>;
}>()("VisionDiagnosticAgent") {
  static make = Effect.gen(function*() {
    const aiModels = yield* AiModels;

    return VisionDiagnosticAgent.of({
      analyzeUpload: ({ applianceType, filePath, fileName }) =>
        Effect.gen(function*() {
          const bytes = yield* Effect.tryPromise(() => readFile(filePath));
          const mediaType = mediaTypeFromPath(filePath);
          const dataUrl = `data:${mediaType};base64,${bytes.toString("base64")}`;

          return yield* LanguageModel.generateObject({
            prompt: Prompt.make([{
              role: "user",
              content: [
                Prompt.textPart({
                  text:
                    `Inspect the appliance photo and return structured output only. The current session appliance hint is ${
                      applianceType ?? "unknown"
                    }. Identify the appliance when possible, summarize visible issues, and list concrete visible signals.`,
                }),
                Prompt.filePart({
                  mediaType,
                  fileName,
                  data: dataUrl,
                }),
              ],
            }]),
            schema: VisionDraft,
          }).pipe(
            aiModels.use("vision"),
            Effect.map((result) => result.value),
          );
        }),
    });
  });

  static layer = Layer.effect(this, this.make).pipe(Layer.provide(AiModels.layer));
}
