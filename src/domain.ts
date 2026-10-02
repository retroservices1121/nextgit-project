export type MissionStatus =
  | "queued"
  | "running"
  | "decision_required"
  | "accepted"
  | "released"
  | "failed";

export type AttemptStatus =
  | "queued"
  | "working"
  | "security_review"
  | "testing"
  | "ready"
  | "blocked"
  | "rejected"
  | "accepted";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface Project {
  id: string;
  name: string;
  canonicalRepositoryId: string;
  createdAt: string;
}

export interface Mission {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: MissionStatus;
  createdAt: string;
}

export interface Attempt {
  id: string;
  missionId: string;
  agentId: string;
  repositoryId: string;
  status: AttemptStatus;
  createdAt: string;
}

export interface SecurityFinding {
  id: string;
  attemptId: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  remediation?: string;
  blocking: boolean;
  resolvedAt?: string;
}

export interface Decision {
  id: string;
  missionId: string;
  attemptId: string;
  decidedBy: string;
  outcome: "accept" | "reject" | "revise";
  rationale?: string;
  createdAt: string;
}
