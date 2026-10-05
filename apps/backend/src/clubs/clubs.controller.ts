import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ClubsHelloAssoService } from "./clubs-helloasso.service";
import { PartnershipQueryService } from "./partnership-query.service";
import { PartnershipService } from "./partnership.service";
import { SoloTeamService } from "./solo-team.service";
import { ConnectHelloAssoDto } from "./dto/connect-helloasso.dto";
import { CreatePartnershipDto } from "./dto/create-partnership.dto";
import { EndPartnershipDto } from "./dto/end-partnership.dto";
import { ValidatePartnershipDto } from "./dto/validate-partnership.dto";
import { CreateSoloTeamDto } from "./dto/create-soloteam.dto";
import { AddSoloTeamMemberDto } from "./dto/add-soloteam-member.dto";
import { SetRegistrationModeDto } from "./dto/registration-mode.dto";

@ApiTags("clubs")
@ApiCommonErrorResponses()
@Controller("clubs")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class ClubsController {
  constructor(
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly partnershipService: PartnershipService,
    private readonly partnershipQueryService: PartnershipQueryService,
    private readonly soloTeamService: SoloTeamService,
  ) {}

  @Get("me/registration-mode")
  @ApiOperation({
    summary: "Mode d'inscription du club du licencié",
    description:
      "Retourne le mode d'inscription du club de l'utilisateur connecté (licencié ou organisateur). " +
      "Permet au client de masquer le bouton « S'inscrire » lorsque le mode est CLUB_ONLY.",
  })
  @ApiResponse({
    status: 200,
    description: "Mode du club (null si l'utilisateur n'a pas de club)",
    schema: {
      type: "object",
      properties: {
        registrationMode: {
          type: "string",
          enum: [
            "CLUB_AND_MEMBERS_PENDING",
            "CLUB_ONLY",
            "MEMBERS_AUTO_CONFIRM",
          ],
          nullable: true,
        },
      },
    },
  })
  async getMyClubRegistrationMode(@Request() req: RequestWithUser) {
    const mode = await this.clubsHelloAssoService.getRegistrationModeForUser(
      req.user.userId,
    );
    return { registrationMode: mode };
  }

  @Get("me/helloasso")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: "État de la connexion HelloAsso du club de l'organisateur",
    description:
      "Retourne si le club a déjà connecté un compte HelloAsso (sans exposer les identifiants).",
  })
  @ApiResponse({ status: 200, description: "Statut récupéré" })
  @ApiResponse({
    status: 400,
    description: "Utilisateur non organisateur ou club non assigné",
  })
  async getHelloAssoStatus(@Request() req: RequestWithUser) {
    return this.clubsHelloAssoService.getMyClubHelloAssoStatus(req.user.userId);
  }

  @Put("me/helloasso")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: "Connecter le compte HelloAsso du club de l'organisateur",
    description:
      "Permet à un organisateur de lier les identifiants HelloAsso de son club. " +
      "Ensuite, tous les paiements (places, etc.) pour les compétitions organisées par ce club utiliseront ce compte.",
  })
  @ApiResponse({ status: 200, description: "HelloAsso connecté avec succès" })
  @ApiResponse({
    status: 400,
    description: "Données invalides ou pas organisateur",
  })
  async connectHelloAsso(
    @Request() req: RequestWithUser,
    @Body() body: ConnectHelloAssoDto,
  ) {
    return this.clubsHelloAssoService.connectHelloAsso(req.user.userId, body);
  }

  @Patch("me/registration-mode")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: "Mode d'inscription du club",
    description:
      "Définit qui peut inscrire les licenciés et comment : " +
      "CLUB_AND_MEMBERS_PENDING (licenciés en attente de validation), " +
      "CLUB_ONLY (seul le club inscrit), " +
      "MEMBERS_AUTO_CONFIRM (validation automatique).",
  })
  @ApiResponse({ status: 200, description: "Mode mis à jour" })
  @ApiResponse({
    status: 400,
    description: "Utilisateur non organisateur ou club non assigné",
  })
  async setRegistrationMode(
    @Request() req: RequestWithUser,
    @Body() body: SetRegistrationModeDto,
  ) {
    return this.clubsHelloAssoService.setRegistrationMode(
      req.user.userId,
      body.registrationMode,
    );
  }

  @Get("me/partnerships")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Liste des couples du club" })
  @ApiQuery({
    name: "activeOnly",
    required: false,
    type: String,
    description: "true = actifs uniquement (défaut)",
  })
  async getPartnerships(
    @Request() req: RequestWithUser,
    @Query("activeOnly") activeOnly?: string,
  ) {
    return this.partnershipQueryService.getPartnerships(
      req.user.userId,
      activeOnly !== "false",
    );
  }

  @Post("me/partnerships")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Créer un couple" })
  async createPartnership(
    @Request() req: RequestWithUser,
    @Body() body: CreatePartnershipDto,
  ) {
    return this.partnershipService.createPartnership(req.user.userId, body);
  }

  @Patch("me/partnerships/:id/end")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Mettre fin à un partenariat" })
  async endPartnership(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() body: EndPartnershipDto,
  ) {
    return this.partnershipService.endPartnership(req.user.userId, id, body);
  }

  @Patch("me/partnerships/:id/validate")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary: "Valider ou refuser un couple inter-club (second club)",
  })
  async validatePartnership(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() body: ValidatePartnershipDto,
  ) {
    return this.partnershipService.validatePartnership(
      req.user.userId,
      id,
      body.accepted,
    );
  }

  @Get("me/partnerships/clubs")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Liste des clubs pour créer un couple inter-club" })
  async getClubsForPartnership(@Request() req: RequestWithUser) {
    return this.partnershipQueryService.getClubsForPartnership(req.user.userId);
  }

  @Get("me/partnerships/members")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({
    summary:
      "Liste des licenciés disponibles pour un couple (mon club + éventuel club partenaire)",
  })
  @ApiQuery({
    name: "secondaryClubId",
    required: false,
    type: String,
    description: "ID du club partenaire sélectionné (optionnel)",
  })
  async getMembersForPartnership(
    @Request() req: RequestWithUser,
    @Query("secondaryClubId") secondaryClubId?: string,
  ) {
    return this.partnershipQueryService.getMembersForPartnership(
      req.user.userId,
      secondaryClubId,
    );
  }

  @Get("me/solo-teams")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Liste des Solo Teams du club" })
  async getSoloTeams(@Request() req: RequestWithUser) {
    return this.soloTeamService.getSoloTeams(req.user.userId);
  }

  @Post("me/solo-teams")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Créer une Solo Team" })
  async createSoloTeam(
    @Request() req: RequestWithUser,
    @Body() body: CreateSoloTeamDto,
  ) {
    return this.soloTeamService.createSoloTeam(req.user.userId, body);
  }

  @Get("me/solo-teams/:id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Détail d'une Solo Team" })
  async getSoloTeam(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.soloTeamService.getSoloTeam(req.user.userId, id);
  }

  @Post("me/solo-teams/:id/members")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Ajouter un membre à une Solo Team" })
  async addSoloTeamMember(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() body: AddSoloTeamMemberDto,
  ) {
    return this.soloTeamService.addSoloTeamMember(
      req.user.userId,
      id,
      body.userId,
    );
  }

  @Delete("me/solo-teams/:id/members/:userId")
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiOperation({ summary: "Retirer un membre d'une Solo Team" })
  async removeSoloTeamMember(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.soloTeamService.removeSoloTeamMember(
      req.user.userId,
      id,
      userId,
    );
  }
}
