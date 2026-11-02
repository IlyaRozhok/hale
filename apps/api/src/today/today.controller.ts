import { BadRequestException, Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { bridgeInput, type BridgePreviewDto, type TodayDto } from "@tablo/contracts";
import { TodayService } from "./today.service";

function parseBridge(body: unknown): number {
  const r = bridgeInput.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data.dailyAmount;
}

@Controller()
export class TodayController {
  constructor(@Inject(TodayService) private readonly today: TodayService) {}

  @Get("today")
  get(): Promise<TodayDto> {
    return this.today.getToday();
  }

  @Post("bridge")
  choose(@Body() body: unknown): Promise<TodayDto> {
    return this.today.chooseBridge(parseBridge(body));
  }

  @Post("bridge/preview")
  preview(@Body() body: unknown): Promise<BridgePreviewDto> {
    return this.today.previewBridge(parseBridge(body));
  }
}
