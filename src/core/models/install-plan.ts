export type InstallAction =
  | { type: "create-symlink"; agentId: string; targetPath: string; linkTarget: string }
  | { type: "skip"; agentId: string; reason: string; targetPath?: string }
  | { type: "conflict"; agentId: string; targetPath: string; reason: string }
  | { type: "repair-broken-link"; agentId: string; targetPath: string; oldTarget: string; newTarget: string };

export interface InstallPlan {
  id: string;
  skillName: string;
  sourceCandidateId: string;
  sourcePath: string;
  actions: InstallAction[];
  hasConflict: boolean;
  warnings: string[];
}

export interface UninstallPlan {
  id: string;
  skillName: string;
  actions: InstallAction[];
  hasConflict: boolean;
  warnings: string[];
}
