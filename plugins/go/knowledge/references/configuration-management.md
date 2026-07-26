# Configuration Management

## Introduction

Application configuration often comes from multiple sources (files, environment variables, command-line flags) and needs careful validation. This document demonstrates production patterns for managing complex configurations.

---

## Example 1: Multi-Source Configuration (Hugo)

**Project:** Hugo
**File:** `config/allconfig/load.go`
**Link:** https://github.com/gohugoio/hugo/blob/master/config/allconfig/load.go

**Pattern:** Layered configuration with environment overrides.

```go
type ConfigSourceDescriptor struct {
    Fs                       afero.Fs
    Logger                   loggers.Logger
    Flags                    config.Provider
    Filename                 string
    ConfigDir                string
    Environment              string
    Environ                  []string
    IgnoreModuleDoesNotExist bool
}

func LoadConfig(d ConfigSourceDescriptor) (configs *Configs, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("failed to load config: %v", r)
            debug.PrintStack()
        }
    }()

    // 1. Apply defaults
    applyDefaultConfig(cfg)

    // 2. Load main configuration file
    if err := loadConfigMain(cfg, d); err != nil {
        return nil, err
    }

    // 3. Apply environment variable overrides
    if err := applyOsEnvOverrides(cfg, d.Environ); err != nil {
        return nil, err
    }

    // 4. Load modules
    hook := func(m *modules.ModulesConfig) error {
        for _, tc := range m.AllModules {
            if len(tc.ConfigFilenames()) > 0 {
                cfg.Merge("", tc.Cfg().Get(""))
            }
        }
        return nil
    }

    if err := loadModules(cfg, hook); err != nil {
        return nil, err
    }

    // 5. Initialize and validate
    configs.Init()

    return configs, nil
}

// Environment variable pattern: HUGO__SECTION__KEY=value
const hugoEnvPrefix = "HUGO"

func applyOsEnvOverrides(cfg config.Provider, environ []string) error {
    for _, env := range environ {
        if !strings.HasPrefix(env, hugoEnvPrefix) {
            continue
        }

        key, val := parseEnvVar(env)
        cfg.Set(key, val)
    }
    return nil
}
```

**Why this is excellent:**
- Clear initialization sequence
- Multiple configuration sources
- Environment variable overrides
- Module/theme configuration merging
- Panic recovery for better error messages

---

## Example 2: Configuration Validation (Terraform)

**Project:** Terraform
**File:** `internal/configs/config.go`
**Link:** https://github.com/hashicorp/terraform/blob/main/internal/configs/config.go

**Pattern:** Hierarchical configuration with dependency verification.

```go
type Config struct {
    Root       *Config
    Parent     *Config
    Path       addrs.Module
    Children   map[string]*Config
    Module     *Module
    CallRange  hcl.Range
    SourceAddr addrs.ModuleSource
    Version    *version.Version
}

// Verify dependency versions match constraints
func (c *Config) VerifyDependencySelections(depLocks *depsfile.Locks) []error {
    reqs, diags := c.ProviderRequirements()
    if diags.HasErrors() {
        return []error{diags.Err()}
    }

    var errs []error
    for provider, constraints := range reqs {
        // Get locked version
        lock := depLocks.Provider(provider)
        if lock == nil {
            errs = append(errs, fmt.Errorf("no lock for %s", provider))
            continue
        }

        // Verify version satisfies constraints
        if !constraints.Acceptable(lock.Version()) {
            errs = append(errs, fmt.Errorf(
                "locked %s %s doesn't satisfy %s",
                provider, lock.Version(), constraints,
            ))
        }
    }

    return errs
}

// Navigate module tree
func (c *Config) Descendant(path addrs.Module) *Config {
    current := c
    for _, name := range path {
        current = current.Children[name]
        if current == nil {
            return nil
        }
    }
    return current
}

// Collect requirements at different scopes
func (c *Config) ProviderRequirements() (getproviders.Requirements, hcl.Diagnostics)
func (c *Config) ProviderRequirementsConfigOnly() (getproviders.Requirements, hcl.Diagnostics)
func (c *Config) ProviderRequirementsShallow() (getproviders.Requirements, hcl.Diagnostics)
func (c *Config) ProviderRequirementsByModule() (map[addrs.Module]getproviders.Requirements, hcl.Diagnostics)
```

**Why this is excellent:**
- Tree structure for module hierarchy
- Multiple requirement gathering methods
- Version constraint validation
- Navigation helpers
- Rich diagnostic information

---

## When to Use

- **Layered configuration** - Defaults → config file → environment variables → command-line flags
- **Environment variable overrides** - Use prefixed env vars (e.g., `APP__SECTION__KEY`) for configuration
- **Configuration validation** - Validate early and provide clear error messages
- **Hierarchical configs** - For modular systems (Terraform modules, Hugo themes)
- **Immutable after initialization** - Initialize once, then treat config as read-only
- **Version constraints** - Validate dependency versions against semantic version constraints

**Source Projects:**
- Hugo: https://github.com/gohugoio/hugo
- Terraform: https://github.com/hashicorp/terraform
