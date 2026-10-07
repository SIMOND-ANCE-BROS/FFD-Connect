import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsString, MaxLength } from "class-validator";

/** Activate (true) or deactivate (false) a user or a club. */
export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

/**
 * The admin re-types the account's email to confirm a final deletion. Not
 * IsEmail: legacy addresses may fail it; the service compares the value.
 */
export class DeleteAdminUserDto {
  @ApiProperty({
    description: "Email du compte, recopié pour confirmer",
    maxLength: 254,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(254)
  confirmEmail!: string;
}
