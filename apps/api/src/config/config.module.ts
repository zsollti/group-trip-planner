import { Global, Module, type DynamicModule } from "@nestjs/common";
import { loadEnv, type Env } from "./env.js";

/** DI token for the validated, immutable environment config. */
export const ENV = Symbol("ENV");

/**
 * Provides the validated environment to the rest of the app.
 *
 * `forRoot()` runs `loadEnv()` while the module metadata is being built — i.e.
 * before Nest wires up anything else — so an invalid environment aborts the
 * bootstrap immediately with the clear error from `loadEnv`.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(): DynamicModule {
    const env: Env = loadEnv();
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
