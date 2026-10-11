import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

/** Longest announcement accepted (Azure Speech is billed per character). */
export const TTS_TEXT_MAX_LENGTH = 500;

/**
 * Body of POST /tts. The text is the only input: the voice, style and output
 * format are fixed server-side (configuration), and the global ValidationPipe
 * (`forbidNonWhitelisted`) rejects any other property with a 400.
 */
export class TtsRequestDto {
  @ApiProperty({
    description: "Texte à convertir en audio",
    example: "Bienvenue sur FFD Connect",
    minLength: 1,
    maxLength: TTS_TEXT_MAX_LENGTH,
  })
  @IsString()
  @Length(1, TTS_TEXT_MAX_LENGTH)
  @Matches(/\S/, { message: "text must not be blank" })
  text!: string;
}
