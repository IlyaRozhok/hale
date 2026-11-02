import { createHash, randomUUID } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import argon2 from "argon2";
import type { Repository } from "typeorm";
import { APP_CONFIG } from "../config.module";
import type { AppConfig } from "../config";
import { Device } from "../db/entities";
import { LoginThrottle } from "./login-throttle";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JwtService) private readonly jwt: JwtService,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  async login(password: string, deviceName: string): Promise<string> {
    if (this.throttle.isLocked()) {
      throw new HttpException("Too many attempts", HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await argon2
      .verify(this.config.OWNER_PASSWORD_HASH, password)
      .catch(() => false);
    if (!ok) {
      this.throttle.recordFailure();
      throw new UnauthorizedException("Invalid credentials");
    }
    this.throttle.reset();

    const token = await this.jwt.signAsync({ jti: randomUUID() });
    await this.devices.insert({ name: deviceName, token_hash: hashToken(token) });
    return token;
  }

  /** Returns the device for a valid, non-revoked token, otherwise null. */
  async deviceForToken(token: string): Promise<Device | null> {
    try {
      await this.jwt.verifyAsync(token);
    } catch {
      return null;
    }
    return this.devices.findOneBy({ token_hash: hashToken(token) });
  }
}
