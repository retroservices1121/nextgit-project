export type WorkMode = "parallel" | "sequence" | "compete";

export interface PlannedTask {
  id: string;
  title: string;
  objective: string;
  agentId: string;
  mode: WorkMode;
  dependsOn: string[];
}

export interface MissionPlan {
  missionId: string;
  summary: string;
  tasks: PlannedTask[];
}

export class MissionPlanner {
  plan(input: { missionId: string; objective: string; agentIds: string[] }): MissionPlan {
    const agents = input.agentIds.length ? input.agentIds : ["agent-a", "agent-b"];
    const clauses = input.objective
      .split(/\s*(?:,|;|\band\b)\s*/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 8);

    const pieces = clauses.length >= 2 ? clauses.slice(0, Math.min(clauses.length, agents.length)) : [input.objective];

    const tasks = pieces.map((objective, index) => ({
      id: crypto.randomUUID(),
      title: `Workstream ${index + 1}`,
      objective,
      agentId: agents[index % agents.length],
      mode: "parallel" as const,
      dependsOn: [],
    }));

    return {
      missionId: input.missionId,
      summary: tasks.length > 1
        ? `Mission decomposed into ${tasks.length} concurrent workstreams.`
        : "Mission kept as one implementation workstream.",
      tasks,
    };
  }
}
