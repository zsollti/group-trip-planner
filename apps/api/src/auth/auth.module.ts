import { Module, type Provider } from "@nestjs/common";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ENV } from "../config/config.module.js";
import { isGoogleOAuthEnabled, type Env } from "../config/env.js";
import { EmailModule } from "../email/email.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { VerifiedEmailGuard } from "./verified-email.guard.js";
import {
  GoogleAuthGuard,
  GoogleConfiguredGuard,
} from "./google-auth.guard.js";
import { GoogleStrategy } from "./google.strategy.js";

/**
 * The Google strategy self-registers with Passport in its constructor, so it is
 * only instantiated when the OAuth client is fully configured. Unconfigured, the
 * provider resolves to null and the /auth/google routes 404 (GoogleConfiguredGuard).
 */
const googleStrategyProvider: Provider = {
  provide: GoogleStrategy,
  inject: [ENV, AuthService],
  useFactory: (env: Env, auth: AuthService) =>
    isGoogleOAuthEnabled(env) ? new GoogleStrategy(env, auth) : null,
};

@Module({
  imports: [
    EmailModule,
    PassportModule,
    // Access-token signing config comes from the validated env. verifyAsync in
    // the guard uses the same secret by default.
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        // The jsonwebtoken types narrow expiresIn to a template-literal string;
        // our env value is a valid `ms` duration ("15m"), so cast to that type.
        signOptions: {
          expiresIn: env.JWT_ACCESS_TTL as JwtSignOptions["expiresIn"],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    VerifiedEmailGuard,
    GoogleConfiguredGuard,
    GoogleAuthGuard,
    googleStrategyProvider,
  ],
  // Re-export the JWT infra + guards so other feature modules (Trips, ...) can
  // protect their own routes with the same authentication + verification gates.
  //
  // `TokenService` is exported for the operator console, which reissues a
  // verification token when someone never received theirs. Deliberately the
  // same issuer registration uses, rather than a second one living in the
  // console: two ways to mint a verification token would be two things to keep
  // in step, and the one used less often is the one that drifts.
  exports: [JwtModule, JwtAuthGuard, VerifiedEmailGuard, TokenService],
})
export class AuthModule {}
