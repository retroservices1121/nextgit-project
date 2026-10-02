export type DecisionKind = "accept" | "reject" | "revise";

export interface AttemptDecision {
  id: string;
  missionId: string;
  attemptId: string;
  decision: DecisionKind;
  feedback?: string;
  decidedAt: string;
}

export class DecisionService {
  decide(input: {
    missionId: string;
    attemptId: string;
    decision: DecisionKind;
    feedback?: string;
  }): AttemptDecision {
    if (input.decision === "revise" && !input.feedback?.trim()) {
      throw new Error("Revision decisions require feedback.");
    }

    return {
      id: crypto.randomUUID(),
      missionId: input.missionId,
      attemptId: input.attemptId,
      decision: input.decision,
      feedback: input.feedback?.trim() || undefined,
      decidedAt: new Date().toISOString(),
    };
  }
}
