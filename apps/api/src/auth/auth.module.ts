import { Module } from "@nestjs/common";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";
import { ENV } from "../config/config.module.js";
import type { Env } from "../config/env.js";
import { EmailModule } from "../email/email.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { VerifiedEmailGuard } from "./verified-email.guard.js";

@Module({
  imports: [
    EmailModule,
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
  providers: [AuthService, TokenService, JwtAuthGuard, VerifiedEmailGuard],
  // Re-export the JWT infra + guards so other feature modules (Trips, ...) can
  // protect their own routes with the same authentication + verification gates.
  exports: [JwtModule, JwtAuthGuard, VerifiedEmailGuard],
})
export class AuthModule {}
