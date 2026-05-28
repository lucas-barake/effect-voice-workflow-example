import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { LanguageModel as LM } from "effect/unstable/ai";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AiModels } from "./ai-models.js";
import { VisionDiagnosticAgent } from "./vision-diagnostic-agent.js";

describe("VisionDiagnosticAgent", () => {
  it.effect("reads the uploaded file, sends it as a png data url, and decodes the analysis", () => {
    let capturedPrompt = "";
    const languageModel = LM.make({
      generateText: (options) => {
        capturedPrompt = JSON.stringify(options.prompt);
        return Effect.succeed([{
          type: "text",
          text: JSON.stringify({
            recognizedApplianceType: "washer",
            analysisSummary: "Surface rust is visible near the bottom panel.",
            visibleSignals: [{
              key: "surface-rust",
              detail: "Surface rust near the bottom panel.",
            }],
          }),
        }]);
      },
      streamText: () => Stream.empty,
    });

    return Effect.gen(function*() {
      const tempDirectory = yield* Effect.acquireRelease(
        Effect.tryPromise(() => mkdtemp(path.join(os.tmpdir(), "vision-agent-"))),
        (directory) => Effect.promise(() => rm(directory, { force: true, recursive: true })),
      );
      const filePath = path.join(tempDirectory, "washer.png");
      yield* Effect.tryPromise(() => writeFile(filePath, new Uint8Array([137, 80, 78, 71])));

      const agent = yield* VisionDiagnosticAgent;
      const result = yield* agent.analyzeUpload({
        applianceType: "washer",
        filePath,
        fileName: "washer.png",
      });

      expect(result).toEqual({
        recognizedApplianceType: "washer",
        analysisSummary: "Surface rust is visible near the bottom panel.",
        visibleSignals: [{
          key: "surface-rust",
          detail: "Surface rust near the bottom panel.",
        }],
      });
      expect(capturedPrompt).toContain("image/png");
      expect(capturedPrompt).toContain("washer.png");
      expect(capturedPrompt).toContain("data:image/png;base64,");
    }).pipe(
      Effect.provide(
        Layer.effect(VisionDiagnosticAgent, VisionDiagnosticAgent.make).pipe(
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
