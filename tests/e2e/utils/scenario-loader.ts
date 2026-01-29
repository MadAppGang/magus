/**
 * YAML scenario loader for E2E tests
 * Loads and validates test scenarios from YAML files
 */

import { readFile, readdir } from "fs/promises";
import YAML from "yaml";

export interface TestScenario {
  name: string;
  description: string;
  plugin: string;
  prompt: string;
  expectations: {
    skills: {
      required: string[];
      optional?: string[];
      forbidden?: string[];
    };
    quality: {
      criteria: QualityCriterion[];
      models: string[];
      thresholds: {
        min_score: number;
        min_consensus: number;
      };
    };
  };
  timeout?: number;
}

export interface QualityCriterion {
  name: string;
  weight: number;
  description: string;
}

export class ScenarioLoader {
  /**
   * Load test scenarios from YAML file
   */
  async load(filePath: string): Promise<TestScenario[]> {
    const content = await readFile(filePath, "utf-8");
    const parsed = YAML.parse(content);

    if (!parsed.scenarios || !Array.isArray(parsed.scenarios)) {
      throw new Error(`Invalid scenario file: ${filePath}`);
    }

    return parsed.scenarios.map((s: any) => this.validate(s, filePath));
  }

  /**
   * Validate scenario structure
   */
  private validate(scenario: any, filePath: string): TestScenario {
    const errors: string[] = [];

    if (!scenario.name) errors.push("Missing 'name'");
    if (!scenario.description) errors.push("Missing 'description'");
    if (!scenario.plugin) errors.push("Missing 'plugin'");
    if (!scenario.prompt) errors.push("Missing 'prompt'");
    if (!scenario.expectations) errors.push("Missing 'expectations'");

    if (scenario.expectations) {
      if (!scenario.expectations.skills) {
        errors.push("Missing 'expectations.skills'");
      } else if (!Array.isArray(scenario.expectations.skills.required)) {
        errors.push("'expectations.skills.required' must be an array");
      }

      if (!scenario.expectations.quality) {
        errors.push("Missing 'expectations.quality'");
      } else {
        if (!Array.isArray(scenario.expectations.quality.criteria)) {
          errors.push("'expectations.quality.criteria' must be an array");
        } else {
          // Validate criteria weights sum to 1.0
          const totalWeight = scenario.expectations.quality.criteria.reduce(
            (sum: number, c: any) => sum + (c.weight || 0),
            0
          );
          if (Math.abs(totalWeight - 1.0) > 0.01) {
            errors.push(
              `Criteria weights must sum to 1.0 (got ${totalWeight})`
            );
          }
        }

        if (!Array.isArray(scenario.expectations.quality.models)) {
          errors.push("'expectations.quality.models' must be an array");
        }

        if (!scenario.expectations.quality.thresholds) {
          errors.push("Missing 'expectations.quality.thresholds'");
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Invalid scenario in ${filePath}: ${errors.join(", ")}`
      );
    }

    return scenario as TestScenario;
  }

  /**
   * Load all scenarios from a directory
   */
  async loadDirectory(dirPath: string): Promise<TestScenario[]> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    const yamlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
      .map((e) => `${dirPath}/${e.name}`);

    const allScenarios: TestScenario[] = [];
    for (const file of yamlFiles) {
      const scenarios = await this.load(file);
      allScenarios.push(...scenarios);
    }

    return allScenarios;
  }
}
