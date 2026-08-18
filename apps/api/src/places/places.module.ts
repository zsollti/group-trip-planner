import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlacesController } from "./places.controller.js";
import { PlacesService } from "./places.service.js";

/**
 * The gazetteer (Phase 8). Exports its service, because the trips module reads a
 * chosen place's facts when it writes a trip — see `PlacesService.facts`.
 *
 * `AuthModule` for the `JwtAuthGuard` the controller applies: the guard is a
 * provider that needs `JwtService`, and a module using one has to import the
 * module that supplies it. Without this the whole app fails to boot rather than
 * failing at the route, which is the good kind of failure and how this was found.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}
