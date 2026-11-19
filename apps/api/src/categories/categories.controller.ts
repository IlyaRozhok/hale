import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put } from "@nestjs/common";
import {
  categoryInput,
  categoryKey,
  categoryOrder,
  categoryPatch,
  type CategoryDeletedDto,
  type CategoryDto,
} from "@hale/contracts";
import type { z } from "zod";
import { CategoriesService } from "./categories.service";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

/** Task В5: the owner's categories. Owner-authenticated by the global guard (not `@Public()`). */
@Controller("categories")
export class CategoriesController {
  constructor(@Inject(CategoriesService) private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<CategoryDto[]> {
    return this.categories.list();
  }

  @Post()
  create(@Body() body: unknown): Promise<CategoryDto> {
    return this.categories.create(parse(categoryInput, body));
  }

  @Put("order")
  reorder(@Body() body: unknown): Promise<CategoryDto[]> {
    return this.categories.reorder(parse(categoryOrder, body).keys);
  }

  @Patch(":key")
  change(@Param("key") key: string, @Body() body: unknown): Promise<CategoryDto> {
    return this.categories.change(parse(categoryKey, key), parse(categoryPatch, body));
  }

  @Delete(":key")
  remove(@Param("key") key: string): Promise<CategoryDeletedDto> {
    return this.categories.remove(parse(categoryKey, key));
  }
}
