import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeMoveUploadedFile } from "./upload-file.js";

describe("moveUploadedFile", () => {
  it.effect("falls back to copy and unlink when rename fails with EXDEV", () =>
    Effect.gen(function*() {
      const rename = vi.fn().mockRejectedValueOnce(
        Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" }),
      );
      const copyFile = vi.fn().mockResolvedValueOnce(undefined);
      const unlink = vi.fn().mockResolvedValueOnce(undefined);

      yield* makeMoveUploadedFile({
        rename,
        copyFile,
        unlink,
      })("/tmp/staged.png", "/data/uploads/final.png");

      expect(rename).toHaveBeenCalledWith("/tmp/staged.png", "/data/uploads/final.png");
      expect(copyFile).toHaveBeenCalledWith("/tmp/staged.png", "/data/uploads/final.png");
      expect(unlink).toHaveBeenCalledWith("/tmp/staged.png");
    }));
});
