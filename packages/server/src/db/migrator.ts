import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgMigrator from "@effect/sql-pg/PgMigrator";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/unstable/sql/Migrator";
import { PgLive } from "./pg-live.js";

export const MigrationLayer = PgMigrator.layer({
  loader: Migrator.fromFileSystem(new URL("./migrations", import.meta.url).pathname),
}).pipe(
  Layer.provide(PgLive),
  Layer.provide(NodeServices.layer),
  Layer.orDie,
);
