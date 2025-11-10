import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import { MODEL_INFO } from "./config.js";
import { OPENROUTER_MODELS, type OpenRouterModel } from "./types.js";

interface ModelSelectorProps {
  onSelect: (model: OpenRouterModel | string) => void;
}

export function ModelSelector({ onSelect }: ModelSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customModelInput, setCustomModelInput] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const { exit } = useApp();

  useInput((input, key) => {
    if (isCustomMode) {
      // Custom model input mode
      if (key.return) {
        if (customModelInput.trim()) {
          onSelect(customModelInput.trim());
          exit();
        }
      } else if (key.backspace || key.delete) {
        setCustomModelInput((prev) => prev.slice(0, -1));
      } else if (key.escape) {
        setIsCustomMode(false);
        setCustomModelInput("");
      } else if (input) {
        setCustomModelInput((prev) => prev + input);
      }
    } else {
      // Model selection mode
      if (key.upArrow) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : OPENROUTER_MODELS.length - 1
        );
      } else if (key.downArrow) {
        setSelectedIndex((prev) =>
          prev < OPENROUTER_MODELS.length - 1 ? prev + 1 : 0
        );
      } else if (key.return) {
        const selected = OPENROUTER_MODELS[selectedIndex];
        if (selected === "custom") {
          setIsCustomMode(true);
        } else {
          onSelect(selected);
          exit();
        }
      } else if (key.escape || (input === "q")) {
        exit();
        process.exit(0);
      }
    }
  });

  if (isCustomMode) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Enter custom OpenRouter model ID:
          </Text>
        </Box>
        <Box>
          <Text color="gray">Model ID: </Text>
          <Text color="white">{customModelInput}</Text>
          <Text color="yellow">_</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text bold>Enter</Text> to confirm, <Text bold>Esc</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select an OpenRouter model:
        </Text>
      </Box>

      {OPENROUTER_MODELS.map((model, index) => {
        const isSelected = index === selectedIndex;
        const info = MODEL_INFO[model as keyof typeof MODEL_INFO];
        const displayName = info ? info.name : model;
        const description = info ? info.description : "Custom model entry";
        const provider = info ? info.provider : "";

        return (
          <Box key={model} marginBottom={0}>
            <Text>
              <Text color={isSelected ? "green" : "gray"}>
                {isSelected ? "❯ " : "  "}
              </Text>
              <Text
                bold={isSelected}
                color={isSelected ? "white" : "gray"}
              >
                {displayName}
              </Text>
              {provider && provider !== "Custom" && (
                <Text dimColor> ({provider})</Text>
              )}
            </Text>
            {isSelected && (
              <Box marginLeft={4}>
                <Text dimColor> {description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          Use <Text bold>↑↓</Text> arrows to navigate, <Text bold>Enter</Text> to select,{" "}
          <Text bold>q</Text> to quit
        </Text>
      </Box>
    </Box>
  );
}
