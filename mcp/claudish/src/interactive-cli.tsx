import { render } from "ink";
import { ModelSelector } from "./model-selector.js";
import type { OpenRouterModel } from "./types.js";

/**
 * Show interactive model selector and return selected model
 */
export async function selectModelInteractively(): Promise<OpenRouterModel | string> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ModelSelector
        onSelect={(model) => {
          unmount();
          resolve(model);
        }}
      />
    );
  });
}
