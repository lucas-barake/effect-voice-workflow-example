import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class AppConfig extends Context.Service<AppConfig, {
  readonly phoneProvider: "local" | "twilio";
  readonly publicAppOrigin: string;
  readonly publicWebhookBaseUrl: string | null;
  readonly twilioAuthToken: string | null;
  readonly uploadDirectory: string;
  readonly serverPort: number;
  readonly localLlmApiUrl: string;
  readonly localLlmApiKey: string | null;
}>()("AppConfig") {}

export const AppConfigLive = Layer.effect(
  AppConfig,
  Effect.gen(function*() {
    const phoneProviderSchema = Schema.Literals(["local", "twilio"] as const);
    return {
      phoneProvider: yield* Config.schema(Schema.String, "PHONE_PROVIDER").pipe(
        Config.withDefault("local"),
        Config.mapOrFail((value) => {
          try {
            return Effect.succeed(Schema.decodeUnknownSync(phoneProviderSchema)(value));
          } catch (error) {
            return Effect.fail(new Config.ConfigError(error as Schema.SchemaError));
          }
        }),
      ),
      publicAppOrigin: yield* Config.string("PUBLIC_APP_ORIGIN"),
      publicWebhookBaseUrl: yield* Config.string("PUBLIC_WEBHOOK_BASE_URL").pipe(
        Config.withDefault(""),
        Config.map((value) => value === "" ? null : value),
      ),
      twilioAuthToken: yield* Config.string("TWILIO_AUTH_TOKEN").pipe(
        Config.withDefault(""),
        Config.map((value) => value === "" ? null : value),
      ),
      uploadDirectory: yield* Config.string("UPLOAD_DIRECTORY").pipe(
        Config.withDefault("./data/uploads"),
      ),
      serverPort: yield* Config.number("SERVER_PORT").pipe(
        Config.withDefault(3000),
      ),
      localLlmApiUrl: yield* Config.string("LOCAL_LLM_API_URL").pipe(
        Config.withDefault("http://127.0.0.1:11434/v1"),
      ),
      localLlmApiKey: yield* Config.string("LOCAL_LLM_API_KEY").pipe(
        Config.withDefault(""),
        Config.map((value) => value === "" ? null : value),
      ),
    };
  }),
);
