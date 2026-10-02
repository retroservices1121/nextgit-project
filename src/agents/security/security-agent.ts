import type { SecurityFinding } from "../../domain";
import { toFinding } from "../../security/policy";
import { deterministicSecurityScan, type ChangedFile } from "./rules";

export interface SecurityReviewResult {
  findings: SecurityFinding[];
  blocking: boolean;
}

export class DeterministicSecurityAgent {
  async inspect(input: {
    attemptId: string;
    files: ChangedFile[];
  }): Promise<SecurityReviewResult> {
    const findings = deterministicSecurityScan(input.files).map((observation) =>
      toFinding(input.attemptId, observation),
    );

    return {
      findings,
      blocking: findings.some((finding) => finding.blocking && !finding.resolvedAt),
    };
  }
}
