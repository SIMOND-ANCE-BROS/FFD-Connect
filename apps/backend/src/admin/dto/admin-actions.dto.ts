import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsBoolean, IsEmail } from "class-validator";

/** Activate (true) or deactivate (false) a user or a club. */
export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

/** The admin re-types the account's email to confirm a final deletion. */
export class DeleteAdminUserDto {
  @ApiProperty({ description: "Email du compte, recopié pour confirmer" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  confirmEmail!: string;
}
