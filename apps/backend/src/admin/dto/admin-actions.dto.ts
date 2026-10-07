import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/** Activate (true) or deactivate (false) a user or a club. */
export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}
