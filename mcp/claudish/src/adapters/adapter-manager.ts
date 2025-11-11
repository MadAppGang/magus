/**
 * Adapter manager for selecting model-specific adapters
 *
 * This allows us to handle different model quirks:
 * - Grok: XML function calls
 * - Deepseek: (future)
 * - Others: (future)
 */

import { BaseModelAdapter, DefaultAdapter } from "./base-adapter";
import { GrokAdapter } from "./grok-adapter";

export class AdapterManager {
  private adapters: BaseModelAdapter[];
  private defaultAdapter: DefaultAdapter;

  constructor(modelId: string) {
    // Register all available adapters
    this.adapters = [new GrokAdapter(modelId)];
    this.defaultAdapter = new DefaultAdapter(modelId);
  }

  /**
   * Get the appropriate adapter for the current model
   */
  getAdapter(): BaseModelAdapter {
    for (const adapter of this.adapters) {
      if (adapter.shouldHandle(this.defaultAdapter["modelId"])) {
        return adapter;
      }
    }
    return this.defaultAdapter;
  }

  /**
   * Check if current model needs special handling
   */
  needsTransformation(): boolean {
    return this.getAdapter() !== this.defaultAdapter;
  }
}
