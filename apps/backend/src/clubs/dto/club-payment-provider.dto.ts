import { ApiProperty } from "@nestjs/swagger";
import { PaymentProvider } from "@prisma/client";
import { IsEnum, IsIn } from "class-validator";
import { SELECTABLE_PAYMENT_PROVIDERS } from "../../payment/connectors/payment-providers";

/** Choice of the club's payment connector (#388). */
export class SetClubPaymentProviderDto {
  @ApiProperty({
    enum: PaymentProvider,
    enumName: "PaymentProvider",
    description:
      "Connecteur de paiement en ligne du club. Seuls les connecteurs disponibles sont acceptés (aujourd'hui : HELLOASSO).",
  })
  @IsEnum(PaymentProvider)
  @IsIn(SELECTABLE_PAYMENT_PROVIDERS, {
    message: "Ce connecteur de paiement n'est pas encore disponible",
  })
  paymentProvider!: PaymentProvider;
}

/** The club's payment connector, without any credential (#388). */
export class ClubPaymentProviderStatusDto {
  @ApiProperty() clubName!: string;

  @ApiProperty({
    enum: PaymentProvider,
    enumName: "PaymentProvider",
    description: "Connecteur choisi (HELLOASSO par défaut)",
  })
  paymentProvider!: PaymentProvider;

  @ApiProperty({
    description:
      "Identifiants du connecteur choisi renseignés (jamais exposés) : le club peut encaisser",
  })
  configured!: boolean;

  @ApiProperty({
    enum: PaymentProvider,
    enumName: "PaymentProvider",
    isArray: true,
    description: "Connecteurs que le club peut choisir",
  })
  selectableProviders!: PaymentProvider[];
}
