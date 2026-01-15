export interface CliTool {
  name: string;
  command: string;
  description: string;
  installCommand: string;
  checkCommand: string;
  category: "essential" | "recommended" | "optional";
  platforms?: ("darwin" | "linux" | "win32")[];
}

export const CLI_TOOLS: CliTool[] = [
  {
    name: "git",
    command: "git",
    description: "Version control system",
    installCommand: "brew install git",
    checkCommand: "git --version",
    category: "essential",
  },
  {
    name: "gh",
    command: "gh",
    description: "GitHub CLI",
    installCommand: "brew install gh",
    checkCommand: "gh --version",
    category: "recommended",
  },
  {
    name: "jq",
    command: "jq",
    description: "JSON processor",
    installCommand: "brew install jq",
    checkCommand: "jq --version",
    category: "recommended",
  },
  {
    name: "fzf",
    command: "fzf",
    description: "Fuzzy finder",
    installCommand: "brew install fzf",
    checkCommand: "fzf --version",
    category: "optional",
  },
  {
    name: "ripgrep",
    command: "rg",
    description: "Fast text search",
    installCommand: "brew install ripgrep",
    checkCommand: "rg --version",
    category: "recommended",
  },
  {
    name: "bat",
    command: "bat",
    description: "Better cat with syntax highlighting",
    installCommand: "brew install bat",
    checkCommand: "bat --version",
    category: "optional",
  },
  {
    name: "fd",
    command: "fd",
    description: "Better find",
    installCommand: "brew install fd",
    checkCommand: "fd --version",
    category: "optional",
  },
  {
    name: "docker",
    command: "docker",
    description: "Container platform",
    installCommand: "brew install --cask docker",
    checkCommand: "docker --version",
    category: "optional",
  },
  {
    name: "kubectl",
    command: "kubectl",
    description: "Kubernetes CLI",
    installCommand: "brew install kubectl",
    checkCommand: "kubectl version --client",
    category: "optional",
  },
  {
    name: "terraform",
    command: "terraform",
    description: "Infrastructure as Code",
    installCommand: "brew install terraform",
    checkCommand: "terraform --version",
    category: "optional",
  },
];
