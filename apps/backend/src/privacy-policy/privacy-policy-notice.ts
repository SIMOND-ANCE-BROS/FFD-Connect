import type { PrivacyPolicyNoticeDto } from "./dto/privacy-policy-notice.dto";
import { PRIVACY_POLICY_VERSION } from "./privacy-policy-version";

/** Notice state from the last version the user acknowledged (#734). */
export function privacyPolicyNotice(
  seenVersion: string | null,
): PrivacyPolicyNoticeDto {
  return {
    currentVersion: PRIVACY_POLICY_VERSION,
    seenVersion,
    pending: seenVersion !== PRIVACY_POLICY_VERSION,
  };
}
