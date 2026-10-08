import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";
import { WALLET_PASS_TOKEN_PATTERN } from "../apple-wallet-pass.service";

/** Path parameter of the public `.pkpass` download route. */
export class WalletPassTokenParamDto {
  @ApiProperty({
    description: "Jeton de téléchargement à usage unique (43 caractères)",
    example: "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW",
  })
  @Matches(WALLET_PASS_TOKEN_PATTERN, {
    message: "token must be a 43-character base64url string",
  })
  token!: string;
}

/** Response of `POST /licenses/my/wallet/apple`. */
export class AppleWalletPassLinkDto {
  @ApiProperty({
    description:
      "URL absolue du pass, à ouvrir dans Safari (qui propose « Ajouter à Apple Wallet »). Usage unique, quelques minutes.",
    example:
      "https://api.example.org/api/v1/licenses/wallet/apple/q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW",
  })
  url!: string;

  @ApiProperty({
    description:
      "Même lien, relatif à la racine de l'API (sans préfixe), si l'app préfère le recomposer avec son URL d'API.",
    example:
      "licenses/wallet/apple/q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW",
  })
  path!: string;

  @ApiProperty({
    description: "Fin de validité du lien",
    type: String,
    format: "date-time",
  })
  expiresAt!: string;
}
