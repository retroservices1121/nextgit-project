import type { Attempt, SecurityFinding } from "../domain";
import type {
  ImplementationAgent,
  ImplementationResult,
  SecurityAgent,
} from "../agents/contracts";
import { evaluateSecurityGate } from "./security-gate";

export interface AttemptExecution {
  attempt: Attempt;
  implementation: ImplementationResult;
  findings: SecurityFinding[];
  eligibleForDecision: boolean;
}

export class MissionOrchestrator {
  constructor(
    private readonly implementationAgents: Map<string, ImplementationAgent>,
    private readonly securityAgent: SecurityAgent,
  ) {}

  async executeAttempts(
    objective: string,
    attempts: Attempt[],
  ): Promise<AttemptExecution[]> {
    // Parallelism is a product primitive, not an optimization.
    return Promise.all(
      attempts.map(async (attempt) => {
        const agent = this.implementationAgents.get(attempt.agentId);
        if (!agent) {
          throw new Error(`No implementation agent registered: ${attempt.agentId}`);
        }

        const implementation = await agent.execute({
          missionId: attempt.missionId,
          attemptId: attempt.id,
          objective,
          repositoryName: attempt.repositoryId,
        });

        const findings = await this.securityAgent.inspect({
          attemptId: attempt.id,
          repositoryName: attempt.repositoryId,
          change: implementation.change,
        });

        const gate = evaluateSecurityGate({
          attemptId: attempt.id,
          findings,
        });

        return {
          attempt,
          implementation,
          findings,
          eligibleForDecision: gate.eligibleForDecision,
        };
      }),
    );
  }
}
