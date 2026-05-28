import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { AppConfig, AppConfigLive } from "./config.js";

const makeConfigLayer = (env: Readonly<Record<string, string>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

describe("AppConfig", () => {
  it.effect("loads defaults and normalizes empty optional values", () =>
    Effect.gen(function*() {
      const config = yield* AppConfig;

      expect(config.phoneProvider).toBe("local");
      expect(config.publicAppOrigin).toBe("http://localhost:4173");
      expect(config.publicWebhookBaseUrl).toBeNull();
      expect(config.twilioAuthToken).toBeNull();
      expect(config.uploadDirectory).toBe("./data/uploads");
      expect(config.serverPort).toBe(3000);
      expect(config.localLlmApiUrl).toBe("http://127.0.0.1:11434/v1");
      expect(config.localLlmApiKey).toBeNull();
    }).pipe(
      Effect.provide(AppConfigLive),
      Effect.provide(makeConfigLayer({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/household_ops_platform",
        PUBLIC_APP_ORIGIN: "http://localhost:4173",
      })),
    ));

  it.effect("loads explicit values when provided", () =>
    Effect.gen(function*() {
      const config = yield* AppConfig;

      expect(config.phoneProvider).toBe("twilio");
      expect(config.publicAppOrigin).toBe("https://ops.example.com");
      expect(config.publicWebhookBaseUrl).toBe("https://hooks.example.com");
      expect(config.twilioAuthToken).toBe("twilio-secret");
      expect(config.uploadDirectory).toBe("/tmp/uploads");
      expect(config.serverPort).toBe(4100);
      expect(config.localLlmApiUrl).toBe("http://ollama.internal:11434/v1");
      expect(config.localLlmApiKey).toBe("secret");
    }).pipe(
      Effect.provide(AppConfigLive),
      Effect.provide(makeConfigLayer({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/household_ops_platform",
        PHONE_PROVIDER: "twilio",
        PUBLIC_APP_ORIGIN: "https://ops.example.com",
        PUBLIC_WEBHOOK_BASE_URL: "https://hooks.example.com",
        TWILIO_AUTH_TOKEN: "twilio-secret",
        UPLOAD_DIRECTORY: "/tmp/uploads",
        SERVER_PORT: "4100",
        LOCAL_LLM_API_URL: "http://ollama.internal:11434/v1",
        LOCAL_LLM_API_KEY: "secret",
      })),
    ));

  it.effect("keeps local mode when explicitly selected even if Twilio env is present", () =>
    Effect.gen(function*() {
      const config = yield* AppConfig;

      expect(config.phoneProvider).toBe("local");
      expect(config.publicWebhookBaseUrl).toBe("https://hooks.example.com");
      expect(config.twilioAuthToken).toBe("twilio-secret");
    }).pipe(
      Effect.provide(AppConfigLive),
      Effect.provide(makeConfigLayer({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/household_ops_platform",
        PHONE_PROVIDER: "local",
        PUBLIC_APP_ORIGIN: "https://ops.example.com",
        PUBLIC_WEBHOOK_BASE_URL: "https://hooks.example.com",
        TWILIO_AUTH_TOKEN: "twilio-secret",
      })),
    ));

  it.effect("fails in the error channel when PHONE_PROVIDER is invalid", () =>
    Effect.gen(function*() {
      const exit = yield* AppConfig.pipe(
        Effect.provide(AppConfigLive),
        Effect.provide(makeConfigLayer({
          DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/household_ops_platform",
          PHONE_PROVIDER: "bogus",
          PUBLIC_APP_ORIGIN: "https://ops.example.com",
        })),
        Effect.exit,
      );

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(Cause.hasFails(exit.cause)).toBe(true);
        expect(Cause.hasDies(exit.cause)).toBe(false);
      }
    }));
});
