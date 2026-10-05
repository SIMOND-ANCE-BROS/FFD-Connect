import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthPasswordService } from "./auth-password.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";
import { EmailService } from "./email.service";
import { JwtStrategy } from "./jwt.strategy";
import { SessionCleanupService } from "./session-cleanup.service";

@Module({
  imports: [
    PassportModule,
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: "60m" },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    AuthTokenService,
    AuthPasswordService,
    JwtStrategy,
    SessionCleanupService,
    EmailService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AuthTokenService, AuthPasswordService],
})
export class AuthModule {}
