import { BadRequestException, Body, Controller, Get, Inject, Post, Delete, Query } from "@nestjs/common";
import { bridgeInput, calendarQuery, settingsPreviewInput, type CalendarDto, type BridgePreviewDto, type SettingsPreviewDto, type TodayDto } from "@hale/contracts";
import { TodayService } from "./today.service";

function parseBridge(body: unknown): number {
  const r = bridgeInput.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data.dailyAmount;
}

function parseCap(body: unknown): number {
  const r = settingsPreviewInput.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data.lifestyleCap;
}

@Controller()
export class TodayController {
  constructor(@Inject(TodayService) private readonly today: TodayService) {}

  @Get("today")
  get(): Promise<TodayDto> {
    return this.today.getToday();
  }

  @Get("today/calendar")
  calendar(@Query() query: unknown): Promise<CalendarDto> {
    const r = calendarQuery.safeParse(query);
    if (!r.success) throw new BadRequestException("month: expected YYYY-MM");
    return this.today.calendar(r.data.month);
  }

  @Post("bridge")
  choose(@Body() body: unknown): Promise<TodayDto> {
    return this.today.chooseBridge(parseBridge(body));
  }

  @Delete("bridge")
  cancel(): Promise<TodayDto> {
    return this.today.cancelBridge();
  }

  @Post("bridge/preview")
  preview(@Body() body: unknown): Promise<BridgePreviewDto> {
    return this.today.previewBridge(parseBridge(body));
  }

  @Post("settings/preview")
  previewCap(@Body() body: unknown): Promise<SettingsPreviewDto> {
    return this.today.previewCap(parseCap(body));
  }
}
