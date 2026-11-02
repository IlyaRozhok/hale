import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { DataSource } from "typeorm";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";

const body = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/) });

@Controller("devices")
export class DevicesController {
  constructor(@Inject(DataSource) private readonly ds: DataSource) {}

  /** Stores the calling device's Expo push token; a token lives on one device only. */
  @Post("push-token")
  @HttpCode(204)
  async setToken(@Body() raw: unknown, @Req() req: AuthedRequest): Promise<void> {
    const parsed = body.safeParse(raw);
    if (!parsed.success) throw new BadRequestException("token must be an Expo push token");
    const id = req.device!.id;
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE devices SET push_token=NULL WHERE push_token=$1 AND id<>$2`, [parsed.data.token, id]);
      await m.query(`UPDATE devices SET push_token=$1 WHERE id=$2`, [parsed.data.token, id]);
    });
  }
}
