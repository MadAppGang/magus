// Design-system guardrails — ESLint flat config template (React + Tailwind v4)
// Install: npm i -D eslint eslint-plugin-react eslint-plugin-better-tailwindcss @eslint-community/eslint-plugin-eslint-comments
// Merge these entries into your existing eslint.config.mjs.

import react from "eslint-plugin-react";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";

// Layout primitives may receive className; everything else may not.
const LAYOUT_COMPONENTS = ["Box", "Stack", "HStack", "VStack", "Grid", "Flex", "Container", "Card"];

export default [
  comments.recommended,

  // ── App code: strict ─────────────────────────────────────────────
  {
    files: ["src/**/*.{jsx,tsx}"],
    ignores: ["src/components/ui/**"], // the library is where this plumbing SHOULD exist
    plugins: { react, "better-tailwindcss": betterTailwindcss },
    settings: {
      // Point at the CSS entry that contains your @theme block:
      "better-tailwindcss": { entryPoint: "src/app.css" },
    },
    rules: {
      // Off-theme / unknown classes error (catches typos AND non-token utilities)
      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-restricted-classes": ["error", {
        restrict: [
          { pattern: String.raw`^.*-\[.*\]$`,
            message: "Arbitrary value — add a token to the theme instead." },
          { pattern: String.raw`^(bg|text|border|ring|fill|stroke|from|via|to)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d+$`,
            message: "Primitive palette class — use a semantic token (bg-primary, text-muted-foreground)." },
          { pattern: String.raw`^dark:.*$`,
            message: "Dark mode is handled by tokens, not per call site." },
        ],
      }],

      // No inline styles; className only on layout primitives
      "react/forbid-component-props": ["error", {
        forbid: [
          { propName: "style", message: "No inline styles — use tokens/variants." },
          { propName: "className", allowedFor: LAYOUT_COMPONENTS,
            message: "Appearance belongs in the component's variants; className is for layout primitives only." },
        ],
      }],

      // Styled raw elements are shadow components
      "react/forbid-elements": ["error", {
        forbid: [
          { element: "button", message: "Use <Button> from @/components/ui." },
          { element: "input", message: "Use <Input> from @/components/ui." },
          { element: "select", message: "Use <Select> from @/components/ui." },
          { element: "textarea", message: "Use <Textarea> from @/components/ui." },
        ],
      }],

      // One entry point to the design system; wrap third-party UI once
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@radix-ui/*", "@headlessui/*", "@mui/*", "antd", "antd/*"],
            message: "Import the wrapped component from @/components/ui instead." },
        ],
      }],

      // Hardcoded colors in TS/JS (chart configs, style objects)
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/^#([0-9a-fA-F]{3,8})$/]",
        message: "Hex color — use a design token.",
      }],

      // Exceptions must carry a reason: // eslint-disable-next-line x -- because…
      "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
    },
  },

  // ── Library code: same token rules, but plumbing is allowed ──────
  {
    files: ["src/components/ui/**/*.{jsx,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: { "better-tailwindcss": { entryPoint: "src/app.css" } },
    rules: {
      "better-tailwindcss/no-unknown-classes": "error",
      "better-tailwindcss/no-restricted-classes": ["error", {
        restrict: [
          { pattern: String.raw`^.*-\[.*\]$`,
            message: "Arbitrary value — even the library uses tokens." },
        ],
      }],
    },
  },
];
