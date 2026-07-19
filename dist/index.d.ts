export interface SkillSummary {
    name: string;
    description: string;
    path: string;
}
export interface InstallOptions {
    force?: boolean;
}
export interface InstallResult {
    installed: string[];
    skipped: string[];
}
export interface ValidationResult {
    count: number;
    errors: string[];
}
export interface RustRuleSummary {
    id: string;
    path: string;
    summary: string;
}
export interface WorkspaceToggleResult {
    agentsPath: string;
    enabled: boolean;
    statePath: string;
    workspace: string;
}
export declare const AGENT_DIRS: Record<string, {
    local: string;
    global: string;
}>;
export declare function resolveAgentDestination(agentOrPath: string, global?: boolean, workspace?: string): string;
export declare function getSupportedAgents(): string[];
export declare function resolveDefaultDestination(global?: boolean, workspace?: string): string;
export declare function suggestAgent(input: string): string | undefined;
export declare function getPackageRoot(): string;
export declare function getSkillsDir(): string;
export declare function getRustRulesDir(): string;
export declare function listRustRules(rulesDir?: string): Promise<RustRuleSummary[]>;
export declare function findRustRules(query: string, rulesDir?: string): Promise<RustRuleSummary[]>;
export declare function readRustRule(ruleId: string, rulesDir?: string): Promise<string>;
export declare function listSkills(skillsDir?: string): Promise<SkillSummary[]>;
export declare function readSkillSummary(folder: string, filePath: string): Promise<SkillSummary>;
export declare function installSkills(destination: string, options?: InstallOptions, skillsDir?: string): Promise<InstallResult>;
export declare function installRouterSkill(destination: string, options?: InstallOptions, skillsDir?: string): Promise<InstallResult>;
export declare function validateSkills(skillsDir?: string): Promise<ValidationResult>;
export declare function setRustTauriWorkspaceMode(workspace: string | undefined, enabled: boolean): Promise<WorkspaceToggleResult>;
export declare function getRustTauriWorkspaceMode(workspace?: string): Promise<WorkspaceToggleResult>;
//# sourceMappingURL=index.d.ts.map