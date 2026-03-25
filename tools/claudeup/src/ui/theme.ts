export const theme = {
  colors: {
    text: "white",
    muted: "#666666",
    dim: "#333333",
    border: "#444444",
    link: "#5c9aff",
    accent: "#7e57c2",
    success: "green",
    warning: "yellow",
    danger: "red",
    info: "cyan",
  },

  selection: {
    bg: "magenta",
    fg: "white",
  },

  scopes: {
    user: "cyan",
    project: "green",
    local: "yellow",
  },

  category: {
    purple: { bg: "#7e57c2", fg: "white", badgeFg: "#d1c4e9" },
    green: { bg: "#2e7d32", fg: "white", badgeFg: "#c8e6c9" },
    teal: { bg: "#00695c", fg: "white", badgeFg: "#b2dfdb" },
    yellow: { bg: "#8d6e00", fg: "white", badgeFg: "#ffe082" },
    gray: { bg: "#455a64", fg: "white", badgeFg: "#cfd8dc" },
    red: { bg: "#b71c1c", fg: "white", badgeFg: "#ffcdd2" },
  },

  meta: {
    muted: "gray",
    warning: "yellow",
    success: "green",
    danger: "red",
  },

  hints: {
    defaultBg: "white",
    primaryBg: "cyan",
    dangerBg: "red",
  },

  spacing: {
    rowIndent: 1,
    sectionGap: 1,
    panelPadding: 1,
  },
} as const;
