import * as Effect from "effect/Effect";
import * as Fs from "node:fs/promises";

export const makeMoveUploadedFile = (
  fileSystem: {
    readonly rename: typeof Fs.rename;
    readonly copyFile: typeof Fs.copyFile;
    readonly unlink: typeof Fs.unlink;
  },
) =>
(sourcePath: string, destinationPath: string) =>
  Effect.tryPromise(async () => {
    try {
      await fileSystem.rename(sourcePath, destinationPath);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EXDEV") {
        throw error;
      }

      await fileSystem.copyFile(sourcePath, destinationPath);
      await fileSystem.unlink(sourcePath);
    }
  }).pipe(Effect.orDie);

export const moveUploadedFile = makeMoveUploadedFile(Fs);
