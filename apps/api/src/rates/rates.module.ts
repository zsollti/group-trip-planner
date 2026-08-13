import { Global, Module } from "@nestjs/common";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import {
  HttpRatesProvider,
  RATES_PROVIDER,
  type RatesProvider,
} from "./rates.provider.js";
import { RatesService } from "./rates.service.js";

/**
 * Daily exchange rates (post-launch).
 *
 * Global because the cost dashboards are not the only surface that will want a
 * rough total, and a rate table is process-wide by nature — there is nothing
 * request-scoped about what a euro is worth.
 *
 * **The provider is null unless configured.** No `EXCHANGE_RATES_URL`, no
 * fetching: the table stays empty, every dashboard reports `converted: null`,
 * and the app behaves exactly as it did before conversion existed. That is what
 * keeps the test suite offline without a single test having to know this module
 * is here.
 */
@Global()
@Module({
  providers: [
    {
      provide: RATES_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): RatesProvider | null =>
        env.EXCHANGE_RATES_URL
          ? new HttpRatesProvider(env.EXCHANGE_RATES_URL)
          : null,
    },
    RatesService,
  ],
  exports: [RatesService],
})
export class RatesModule {}
