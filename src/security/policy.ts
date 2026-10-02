import type { FindingSeverity, SecurityFinding } from "../domain";

export interface SecurityObservation {
  title: string;
  description: string;
  severity: FindingSeverity;
  file?: string;
  line?: number;
  remediation?: string;
}

const BLOCKING_SEVERITIES = new Set<FindingSeverity>(["high", "critical"]);

export function toFinding(
  attemptId: string,
  observation: SecurityObservation,
): SecurityFinding {
  return {
    id: crypto.randomUUID(),
    attemptId,
    ...observation,
    blocking: BLOCKING_SEVERITIES.has(observation.severity),
  };
}

export function canAdvanceToDecision(findings: SecurityFinding[]): boolean {
  return findings.every((finding) => !finding.blocking || Boolean(finding.resolvedAt));
}
