import { AgentRole } from "../config/schema.js";

/** Pre-defined team compositions */
export enum TeamPreset {
  Default = "default",
  Full = "full",
  Solo = "solo",
  SecurityFocused = "security-focused",
}

/** Agent config from ForgeConfig */
export interface TeamConfig {
  team: AgentRole[];
  soloMode: boolean;
}

/** Canonical pipeline ordering for agent roles */
const PIPELINE_ORDER: AgentRole[] = [
  AgentRole.Architect,
  AgentRole.Implementer,
  AgentRole.Tester,
  AgentRole.Security,
  AgentRole.Reviewer,
  AgentRole.Documenter,
];

const PRESETS: Record<TeamPreset, AgentRole[]> = {
  [TeamPreset.Default]: [
    AgentRole.Architect,
    AgentRole.Implementer,
    AgentRole.Tester,
    AgentRole.Reviewer,
  ],
  [TeamPreset.Full]: [
    AgentRole.Architect,
    AgentRole.Implementer,
    AgentRole.Tester,
    AgentRole.Reviewer,
    AgentRole.Security,
    AgentRole.Documenter,
  ],
  [TeamPreset.Solo]: [AgentRole.Implementer],
  [TeamPreset.SecurityFocused]: [
    AgentRole.Implementer,
    AgentRole.Tester,
    AgentRole.Security,
    AgentRole.Reviewer,
  ],
};

/**
 * Composes and manages an agent team.
 *
 * Supports presets (Default, Full, Solo, SecurityFocused),
 * custom role lists, and config-driven composition.
 * Provides role rotation and iteration pipeline ordering.
 */
export class TeamComposer {
  readonly roles: AgentRole[];

  private constructor(roles: AgentRole[]) {
    this.roles = roles;
  }

  /** Create team from a preset */
  static fromPreset(preset: TeamPreset): TeamComposer {
    return new TeamComposer([...PRESETS[preset]]);
  }

  /** Create team from an explicit role list (deduplicates) */
  static fromRoles(roles: AgentRole[]): TeamComposer {
    const unique = [...new Set(roles)];
    if (unique.length === 0) {
      throw new Error("Team must have at least one role");
    }
    return new TeamComposer(unique);
  }

  /** Create team from ForgeConfig agents section */
  static fromConfig(config: TeamConfig): TeamComposer {
    if (config.soloMode) {
      return new TeamComposer([config.team[0] ?? AgentRole.Implementer]);
    }
    return TeamComposer.fromRoles(config.team);
  }

  /** Get the next role for a given iteration (round-robin) */
  nextRole(iteration: number): AgentRole {
    return this.roles[iteration % this.roles.length]!;
  }

  /**
   * Get the canonical pipeline for one iteration.
   *
   * Returns roles sorted by pipeline order:
   * Architect → Implementer → Tester → Security → Reviewer → Documenter
   */
  iterationPipeline(): AgentRole[] {
    return PIPELINE_ORDER.filter((r) => this.roles.includes(r));
  }
}
