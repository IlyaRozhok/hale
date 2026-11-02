import { BadRequestException, Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { type AuthedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";
import { Public } from "./public.decorator";

const loginBody = z.object({
  password: z.string().min(1),
  deviceName: z.string().trim().min(1).max(100),
});

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: unknown): Promise<{ token: string }> {
    const parsed = loginBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("password and deviceName are required");
    const token = await this.auth.login(parsed.data.password, parsed.data.deviceName);
    return { token };
  }

  @Get("me")
  me(@Req() req: AuthedRequest): { deviceName: string } {
    return { deviceName: req.device!.name };
  }
}
