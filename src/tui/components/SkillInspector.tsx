import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { InstallationRecord } from "../../core/models/installation.js";
import type { SkillRecord } from "../../core/models/skill.js";
import { cellSymbol, type MatrixAgentColumn } from "./Matrix.js";
import type { PendingIntent } from "../state/types.js";

export interface SkillInspectorProps {
  readonly skill: SkillRecord | null;
  readonly agents: readonly MatrixAgentColumn[];
  readonly installations: Record<string, InstallationRecord>;
  readonly pending: ReadonlyMap<string, ReadonlyMap<string, PendingIntent>>;
}

/** 选中 skill 的详情面板（纯展示）：name/status/description + candidates + 各 agent 安装摘要。 */
export function SkillInspector({ skill, agents, installations, pending }: SkillInspectorProps): ReactElement {
  if (!skill) {
    return (
      <Text dimColor>Select a skill to inspect its candidates and installation status.</Text>
    );
  }
  const skillPending = pending.get(skill.name);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold>{skill.displayName}</Text>
        <Text dimColor> ({skill.status})</Text>
      </Text>
      {skill.description ? <Text dimColor>{skill.description}</Text> : null}
      {skill.tags.length > 0 ? <Text dimColor>tags: {skill.tags.join(", ")}</Text> : null}

      <Text bold underline>
        candidates
      </Text>
      {skill.candidates.length === 0 ? (
        <Text dimColor>none</Text>
      ) : (
        skill.candidates.map((candidate) => (
          <Text key={candidate.id}>
            {"  "}
            <Text bold>{candidate.sourceId}</Text>
            {"  "}
            <Text dimColor>{candidate.path}</Text>
          </Text>
        ))
      )}

      <Text bold underline>
        installations
      </Text>
      {agents.map((agent) => {
        const record = installations[`${skill.name}:${agent.id}`];
        const intent = skillPending?.get(agent.id);
        return (
          <Text key={agent.id}>
            {cellSymbol(record?.status, intent)} <Text bold>{agent.id}</Text>
            <Text dimColor> {record?.status ?? "—"}</Text>
            {record?.reason ? <Text dimColor> — {record.reason}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
