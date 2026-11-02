import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./config";

const config = loadConfig(process.env);
const app = await NestFactory.create(AppModule.forRoot(config));
await app.listen(config.PORT);
