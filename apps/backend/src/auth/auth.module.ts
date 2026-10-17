import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AdminAuditModule } from "../admin/admin-audit.module";
import { ParentalConsentModule } from "../parental-consent/parental-consent.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthPasswordService } from "./auth-password.service";
import { AuthService } from "./auth.service";
import { AuthTokenService } from "./auth-token.service";
import { EmailService } from "./email.service";
import { ImpersonationActionLogMiddleware } from "./impersonation-action-log.middleware";
import { ImpersonationActionLogService } from "./impersonation-action-log.service";
import { ImpersonationLogRetentionService } from "./impersonation-log-retention.service";
import { JwtStrategy } from "./jwt.strategy";
import { SessionCleanupService } from "./session-cleanup.service";

@Module({
  imports: [
    PassportModule,
    PrismaModule,
    ParentalConsentModule,
    // Audit-trail retention purge (#741), run by SessionCleanupService.
    AdminAuditModule,
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
    ImpersonationLogRetentionService,
    ImpersonationActionLogService,
    EmailService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AuthTokenService, AuthPasswordService, EmailService],
})
export class AuthModule implements NestModule {
  /** Journals the writes made during a support access, on every route (#761). */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ImpersonationActionLogMiddleware).forRoutes("*");
  }
}
