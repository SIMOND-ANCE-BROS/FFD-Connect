import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * HelloAsso webhook payload — only the fields FFD-Connect reads are declared.
 * HelloAsso sends many more (payer, items, form…): the webhook route validates
 * this DTO with `whitelist` but WITHOUT `forbidNonWhitelisted`, so unknown
 * fields are stripped instead of rejected (see PaymentController).
 *
 * Amounts are integers in cents, ids are integers (HelloAsso API v5). Only
 * fields whose shape is the same for every event type are declared (`data` of
 * a `Payment` event is a payment, not an order: e.g. its `amount` is a number).
 */
export class WebhookMetadataDto {
  @ApiPropertyOptional({ example: "booking-uuid" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  bookingId?: string;

  @ApiPropertyOptional({ example: "comp-uuid" })
  @IsOptional()
  @IsString()
  competitionId?: string;
}

export class WebhookPaymentDto {
  @ApiPropertyOptional({ example: 123456 })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty({ example: 1500, description: "Montant en centimes" })
  @IsInt()
  amount!: number;

  @ApiProperty({
    example: "Authorized",
    description: "État du paiement HelloAsso (Authorized, Refused, …)",
  })
  @IsString()
  state!: string;
}

export class WebhookDataDto {
  @ApiPropertyOptional({
    example: 98765,
    description: "Identifiant de l'ordre",
  })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiPropertyOptional({ example: 4242 })
  @IsOptional()
  @IsInt()
  checkoutIntentId?: number;

  @ApiPropertyOptional({ type: [WebhookPaymentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WebhookPaymentDto)
  payments?: WebhookPaymentDto[];

  /** Legacy location of the checkout metadata (kept for compatibility). */
  @ApiPropertyOptional({ type: WebhookMetadataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookMetadataDto)
  metadata?: WebhookMetadataDto;
}

export class WebhookPayloadDto {
  @ApiProperty({ example: "Order" })
  @IsString()
  @IsNotEmpty()
  eventType!: string;

  @ApiProperty({ type: WebhookDataDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data!: WebhookDataDto;

  /** Checkout-intent metadata, echoed by HelloAsso at the payload root. */
  @ApiPropertyOptional({ type: WebhookMetadataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookMetadataDto)
  metadata?: WebhookMetadataDto;
}
