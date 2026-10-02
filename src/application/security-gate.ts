import type { SecurityFinding } from "../domain";
import { canAdvanceToDecision } from "../security/policy";

export interface AttemptSecurityState {
  attemptId: string;
  findings: SecurityFinding[];
}

export interface SecurityGateResult {
  attemptId: string;
  eligibleForDecision: boolean;
  blockingFindings: SecurityFinding[];
}

export function evaluateSecurityGate(
  state: AttemptSecurityState,
): SecurityGateResult {
  const blockingFindings = state.findings.filter(
    (finding) => finding.blocking && !finding.resolvedAt,
  );

  return {
    attemptId: state.attemptId,
    eligibleForDecision: canAdvanceToDecision(state.findings),
    blockingFindings,
  };
}
