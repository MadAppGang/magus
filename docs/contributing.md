# Contributing to Magus

We welcome contributions from the community! This guide will help you submit high-quality plugins.

---

## 🚀 Quick Contribution Process

### 1. Fork this Repository

Click "Fork" on GitHub to create your own copy.

### 2. Create a Feature Branch

```bash
git checkout -b feature/your-plugin-name
```

Use descriptive branch names:
- `feature/database-tools` - For new plugins
- `fix/frontend-bug` - For bug fixes
- `docs/improve-readme` - For documentation

### 3. Develop Your Plugin

Follow the **[Development Guide](./development-guide.md)** to create your plugin:

- ✅ Create plugin directory structure
- ✅ Write plugin.json manifest
- ✅ Add agents, commands, or skills
- ✅ Write comprehensive README
- ✅ Test thoroughly in real projects
- ✅ Document all features and requirements

### 4. Commit Your Changes

```bash
git add .
git commit -m "Add [plugin-name]: [brief description]"
```

**Good commit messages:**
- `Add database-tools: PostgreSQL migration helper`
- `Fix frontend: Resolve Figma import error`
- `Docs: Add troubleshooting section to README`

### 5. Push and Create PR

```bash
git push origin feature/your-plugin-name
```

Then create a Pull Request on GitHub.

### 6. Create Pull Request

Your PR description should include:

```markdown
## Plugin Name

[Brief description of what your plugin does]

## Features

- Feature 1
- Feature 2
- Feature 3

## Usage Example

[Show how to use the plugin]

## Testing

Tested in:
- [x] macOS
- [ ] Linux
- [ ] Windows

Tested with:
- [x] Real project (describe project)
- [x] Multiple scenarios
- [x] Edge cases

## Dependencies

- Node.js 18+
- [Any other dependencies]

## Checklist

- [x] Follows development guide
- [x] Includes comprehensive README
- [x] Tested in real projects
- [x] No breaking changes to existing plugins
- [x] Documentation is clear and complete
```

---

## 📋 Contribution Guidelines

### Be Specific

**Good:** Plugin that generates TypeScript types from OpenAPI specs
**Not Good:** Plugin that "helps with APIs"

Plugins should solve specific, well-defined problems. Avoid vague or overly broad scopes.

### Be Compatible

- ✅ Works with standard Claude Code installations
- ✅ No custom Claude Code modifications required
- ✅ Compatible with other plugins
- ✅ Uses standard plugin manifest format

### Be Documented

**Required documentation:**

1. **README.md** in plugin directory:
   - What the plugin does
   - Installation instructions
   - Usage examples
   - Configuration requirements
   - Troubleshooting

2. **Inline documentation**:
   - Comments in complex workflows
   - Agent/command/skill descriptions
   - Example usage in code

3. **DEPENDENCIES.md** (if applicable):
   - System requirements
   - Environment variables
   - External dependencies

### Be Tested

**Minimum testing requirements:**

- ✅ Tested in at least one real project
- ✅ Multiple usage scenarios verified
- ✅ Error handling tested
- ✅ Works with latest Claude Code version

**Bonus points:**

- ✅ Tested on multiple platforms (macOS, Linux, Windows)
- ✅ Tested by multiple developers
- ✅ Tested in team environments
- ✅ Includes automated tests

### Be Collaborative

- ✅ Respond to feedback promptly
- ✅ Iterate based on review comments
- ✅ Help other contributors
- ✅ Keep PR focused and manageable

---

## 🎯 Plugin Ideas We're Looking For

### High Priority

**Code Quality Tools**
- ESLint/Biome integration with auto-fix
- TypeScript strict mode migration helper
- Security vulnerability scanner
- Code complexity analyzer

**API Development**
- OpenAPI spec generator from code
- GraphQL schema validator
- API client generator (TypeScript, Go, Python)
- Postman/Insomnia collection importer

**Database Tools**
- Migration generator and runner
- Query builder with type safety
- ORM helper (Prisma, Drizzle, TypeORM)
- Database schema visualizer

### Medium Priority

**DevOps Automation**
- Docker compose generator
- Kubernetes manifest builder
- CI/CD pipeline generator (GitHub Actions, GitLab CI)
- Infrastructure as Code helper (Terraform, Pulumi)

**Documentation Generators**
- Component documentation from JSDoc
- API reference generator
- Changelog generator from commits
- Architecture diagram generator

**Performance Tools**
- Bundle analyzer integration
- Performance profiling helper
- Lighthouse CI integration
- Core Web Vitals monitor

### Future Ideas

**Security Tools**
- Dependency vulnerability scanner
- Auth flow generator (OAuth, JWT)
- OWASP security checker
- Secret scanner and vault integration

**Testing Tools**
- E2E test generator (Playwright, Cypress)
- Visual regression testing
- Load testing helper (k6, Artillery)
- Test data generator

**UI/UX Tools**
- Design token manager
- Component library generator
- Accessibility checker
- Responsive design helper

---

## 🔍 Review Process

### What We Look For

**1. Quality**
- Code is clean and well-organized
- Follows plugin development best practices
- Meets quality standards

**2. Utility**
- Solves a real problem
- Provides clear value
- Reusable across projects

**3. Documentation**
- Clear README with examples
- All features documented
- Troubleshooting included

**4. Testing**
- Verified in real projects
- Edge cases handled
- Error messages are helpful

### Review Timeline

- **Initial review**: Within 3-5 days
- **Follow-up**: Within 2 days of updates
- **Merge**: After approval from maintainers

### What Happens Next

1. **Review**: Maintainers review your PR
2. **Feedback**: You'll receive constructive feedback
3. **Iterate**: Make requested changes
4. **Approval**: Once approved, we'll merge
5. **Release**: Your plugin will be included in next release

---

## 🎨 Code Style

Follow these conventions:

### File Naming

- **Agents**: `agent-name.md` (kebab-case)
- **Commands**: `command-name.md` (kebab-case)
- **Skills**: `skill-name/SKILL.md` (kebab-case folder, SKILL.md file)
- **MCP Servers**: `mcp-config.json`

### Markdown Style

- Use ATX-style headers (`##` not `---`)
- Include emoji in section headers for visual hierarchy
- Use code blocks with language specification
- Include examples for all features

### JSON Style

- 2-space indentation (or tabs if project uses them)
- Double quotes for strings
- No trailing commas
- Alphabetize object keys where sensible

---

## 🚫 What We Don't Accept

**Rejected contributions:**

- ❌ Plugins that duplicate existing functionality
- ❌ Malicious code or security vulnerabilities
- ❌ Poorly documented or untested plugins
- ❌ Plugins with unclear licensing
- ❌ Plugins that violate Claude's usage policies
- ❌ Spam or promotional content

**If unsure, open an issue first to discuss your idea!**

---

## 💡 Tips for Successful Contributions

### Start Small

Don't build a massive plugin for your first contribution. Start with:
- A single, focused agent
- A simple command
- A useful skill

### Get Feedback Early

Open a draft PR early to get feedback before investing too much time.

### Study Existing Plugins

Look at the `frontend` and `code-analysis` plugins as examples of quality work.

### Ask Questions

Not sure about something? Open an issue or ask in your PR. We're here to help!

---

## 📞 Getting Help

### Before Contributing

- **Read**: [Development Guide](./development-guide.md)
- **Check**: Existing plugins for examples
- **Search**: GitHub issues for similar ideas

### During Development

- **Question**: Open issue with `question` label
- **Idea**: Open issue with `plugin-idea` label
- **Bug**: Open issue with `bug` label

### After Submission

- **PR Feedback**: Respond in PR comments
- **Follow-up**: Check your PR for review comments
- **Updates**: Push fixes to your branch

---

## 🙏 Recognition

Contributors will be:
- ✅ Listed in plugin README as authors
- ✅ Credited in release notes
- ✅ Mentioned in project documentation
- ✅ Added to CONTRIBUTORS.md (coming soon)

---

## 📜 Code of Conduct

Be respectful, collaborative, and professional:

- ✅ Be welcoming to newcomers
- ✅ Accept constructive criticism gracefully
- ✅ Focus on what's best for the community
- ✅ Show empathy towards other contributors

---

## 🎯 Contribution Checklist

Before submitting your PR, verify:

- [ ] Plugin follows directory structure
- [ ] `plugin.json` is valid and complete
- [ ] README.md is comprehensive
- [ ] All features are documented
- [ ] Tested in real project
- [ ] No hardcoded secrets or API keys
- [ ] Environment variables documented
- [ ] Error messages are helpful
- [ ] Examples are included
- [ ] Follows code style guidelines
- [ ] PR description is complete
- [ ] Branch name is descriptive

---

**Thank you for contributing to Magus!** 🚀

Your contributions help developers ship faster and build better software.

---

**Questions?** Email [i@madappgang.com](mailto:i@madappgang.com)
