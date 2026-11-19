import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { observationRef, type ObservationRef, type ObservationTodayDto } from "@hale/contracts";
import { ObservationsService } from "./observations.service";

function parseRef(body: unknown): ObservationRef {
  const r = observationRef.safeParse(body);
  if (!r.success) throw new BadRequestException("expected { kind: 'spike', category } or { kind: 'subscriptions', category: null }");
  return r.data;
}

/** Task В7: the phrase of the day's observation. Owner-authenticated by the global guard (not `@Public()`). */
@Controller("observations")
export class ObservationsController {
  constructor(@Inject(ObservationsService) private readonly observations: ObservationsService) {}

  /** Today's observation, or null. Reads only. */
  @Get("today")
  today(): Promise<ObservationTodayDto> {
    return this.observations.current();
  }

  /** The app displayed today's observation. Idempotent; another one on the same day is 409. */
  @Post("shown")
  shown(@Body() body: unknown): Promise<ObservationTodayDto> {
    return this.observations.shown(parseRef(body));
  }

  /** «Не показывать такое». Idempotent. */
  @Post("dismiss")
  @HttpCode(204)
  async dismiss(@Body() body: unknown): Promise<void> {
    await this.observations.dismiss(parseRef(body));
  }
}
