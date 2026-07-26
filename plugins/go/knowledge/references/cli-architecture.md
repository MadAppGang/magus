# CLI Architecture

## Introduction

Command-line interfaces require careful design to provide consistent behavior across commands. This document demonstrates production patterns for building robust CLI applications in Go.

---

## Example 1: Meta Command Pattern (Terraform)

**Project:** Terraform
**File:** `internal/command/meta.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/command/meta.go

**Pattern:** Shared meta struct for common CLI functionality.

```go
type Meta struct {
    WorkingDir           *workdir.Dir
    Streams              *terminal.Streams
    View                 *views.View
    Color                bool
    GlobalPluginDirs     []string
    Ui                   cli.Ui
    Services             *disco.Disco
    RunningInAutomation  bool
    CLIConfigDir         string
    PluginCacheDir       string
    ShutdownCh           <-chan struct{}
}

// Shared flag sets
func (m *Meta) defaultFlagSet(n string) *flag.FlagSet {
    f := flag.NewFlagSet(n, flag.ContinueOnError)
    f.SetOutput(ioutil.Discard)
    f.Usage = func() {}
    return f
}

func (m *Meta) extendedFlagSet(n string) *flag.FlagSet {
    f := m.defaultFlagSet(n)
    f.BoolVar(&m.input, "input", true, "input")
    f.Var((*arguments.FlagStringSlice)(&m.targetFlags),
        "target", "resource to target")
    f.BoolVar(&m.compactWarnings, "compact-warnings", false,
        "use compact warnings")
    return f
}

// Flag processing
func (m *Meta) process(args []string) []string {
    m.color = m.Color
    i := 0
    for _, v := range args {
        if v == "-no-color" {
            m.color = false
            m.Color = false
        } else {
            args[i] = v
            i++
        }
    }
    args = args[:i]

    // Reconfigure UI
    m.Ui = &cli.ConcurrentUi{
        Ui: &ColorizeUi{
            Colorize: m.Colorize(),
        },
    }
    return args
}
```

**Why this is excellent:**
- Avoids duplication across commands
- Composable flag sets
- Centralized UI handling
- Consistent color management

---

## Example 2: Interruptible Commands (Terraform)

**Project:** Terraform
**File:** `internal/command/meta.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/command/meta.go

**Pattern:** Graceful shutdown handling for long-running operations.

```go
func (m *Meta) InterruptibleContext(base context.Context)
    (context.Context, context.CancelFunc) {

    if m.ShutdownCh == nil {
        return base, func() {}
    }

    ctx, cancel := context.WithCancel(base)

    go func() {
        select {
        case <-m.ShutdownCh:
            cancel()
        case <-ctx.Done():
        }
    }()

    return ctx, cancel
}

// Usage in commands
func (c *ApplyCommand) Run(args []string) int {
    ctx, cancel := c.Meta.InterruptibleContext(context.Background())
    defer cancel()

    // Long-running operation respects cancellation
    err := c.apply(ctx, plan)
    if ctx.Err() != nil {
        c.Ui.Error("Operation interrupted")
        return 1
    }

    return 0
}
```

**Why this is excellent:**
- Graceful Ctrl-C handling
- Context propagation to operations
- Clean shutdown in goroutines
- Testable (nil channel for tests)

---

## When to Use

- **Meta/Base command pattern** - When you have multiple commands that share configuration and behavior
- **Composable flag sets** - Build complex flag combinations from simple building blocks
- **Interruptible operations** - Always support graceful shutdown for long-running CLI commands
- **Structured output** - Support both human-readable and machine-readable (JSON) output formats
- **Exit codes** - Use consistent exit codes (0 = success, 1 = error, 2 = usage error)

**Source Projects:**
- Terraform: https://github.com/hashicorp/terraform
