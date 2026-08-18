import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { PlaceSearchResult } from "@gtp/types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PlacesService } from "./places.service.js";

/**
 * The destination type-ahead (`GET /places?q=`).
 *
 * **Authenticated, though the data is public.** Every caller is somebody creating
 * or editing a trip, which already requires an account — so requiring one here
 * costs nothing and keeps a keystroke-rate endpoint off the open internet. The
 * per-user rate limit the app applies to authenticated routes then applies to
 * this one for free, which matters for the one endpoint designed to be called on
 * every letter typed.
 *
 * No trip context and no permission: a gazetteer is not anybody's data. This is
 * the only route in the app that reads a table no user has ever written to.
 */
@Controller("places")
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /**
   * Places matching `q`, best first, at most eight.
   *
   * A missing or too-short `q` is an empty list rather than a 400: this is called
   * from a field as it is being typed, and the first keystroke is not a client
   * error.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  search(@Query("q") q?: string): Promise<PlaceSearchResult> {
    return this.places.search(q ?? "");
  }
}
