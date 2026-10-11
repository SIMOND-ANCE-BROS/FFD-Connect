import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { UsageBatchDto } from "./dto/usage-event.dto";
import { UsageIntakeService } from "./usage-intake.service";

/**
 * Anonymous usage intake (lot 5). Deliberately WITHOUT auth guard: no event
 * can be tied to an account. The app sends only while the backend is awake.
 */
@ApiTags("analytics")
@ApiCommonErrorResponses()
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly intake: UsageIntakeService) {}

  @Post("events")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Anonymous app usage events (batch, no auth)" })
  @ApiResponse({ status: 204, description: "Stored" })
  async ingest(@Body() body: UsageBatchDto): Promise<void> {
    await this.intake.ingest(body.events);
  }
}
