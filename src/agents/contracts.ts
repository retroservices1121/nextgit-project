import type { SecurityFinding } from "../domain";

export interface AgentChangeSummary {
  filesChanged: string[];
  summary: string;
}

export interface ImplementationResult {
  attemptId: string;
  change: AgentChangeSummary;
  completedAt: string;
}

export interface ImplementationAgent {
  id: string;
  execute(input: {
    missionId: string;
    attemptId: string;
    objective: string;
    repositoryName: string;
  }): Promise<ImplementationResult>;
}

export interface SecurityAgent {
  inspect(input: {
    attemptId: string;
    repositoryName: string;
    change: AgentChangeSummary;
  }): Promise<SecurityFinding[]>;
}
