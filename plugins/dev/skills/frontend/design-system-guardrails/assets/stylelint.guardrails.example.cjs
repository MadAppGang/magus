// Design-system guardrails — Stylelint template (handwritten CSS/SCSS)
// Install: npm i -D stylelint stylelint-declaration-strict-value
// Token definition files are exempt via overrides — they are the one place raw values belong.

module.exports = {
  plugins: ["stylelint-declaration-strict-value"],
  rules: {
    "color-no-hex": true,
    "scale-unlimited/declaration-strict-value": [
      [
        "/color$/", "fill", "stroke", "background", "background-color",
        "box-shadow", "border-radius", "font-size", "font-family", "z-index",
      ],
      {
        ignoreValues: [
          "currentColor", "transparent", "inherit", "initial", "unset", "none", "0", "auto",
        ],
        expandShorthand: true,
        message:
          "Use a design token (var(--…)) — raw values only belong in the theme file.",
      },
    ],
  },
  overrides: [
    {
      // The single source of truth is allowed to contain raw values.
      files: [
        "**/tokens.css", "**/*.tokens.css", "**/theme.css",
        "**/app.css", "**/globals.css", "**/global.css", "**/variables.css",
      ],
      rules: {
        "color-no-hex": null,
        "scale-unlimited/declaration-strict-value": null,
      },
    },
  ],
};
