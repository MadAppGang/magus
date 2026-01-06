# Research Findings: AI Deep Research Techniques

## Sources

1. [Deep Research: A Survey of Autonomous Research Agents](https://arxiv.org/html/2508.12752v1) (arXiv, Aug 2025)
2. [Answer Convergence as a Signal for Early Stopping](https://arxiv.org/html/2506.02536v1) (arXiv, Jun 2025)
3. [DeepResearcher: Scaling Deep Research via RL](https://arxiv.org/html/2504.03160v1) (arXiv, Apr 2025)
4. [ReAct: Synergizing Reasoning and Acting](https://arxiv.org/abs/2210.03629) (Google Research)

---

## Key Findings

### 1. Deep Research Pipeline (4 Core Stages)

From the arXiv survey on autonomous research agents:

| Stage | Description | Output |
|-------|-------------|--------|
| **Planning** | Decompose high-level research question into structured sub-goals | Task decomposition tree |
| **Question Developing** | Formulate retrieval queries capturing specific information needs | Search queries |
| **Web Exploration** | Actively interact with external sources via APIs or browser | Retrieved evidence |
| **Report Generation** | Integrate retrieved information, select evidence, organize coherently | Final report |

### 2. Stopping/Finalization Criteria (CRITICAL)

From "Answer Convergence" paper:

**Answer Consistency Method (k=10)**:
- Monitor outputs at sentence boundaries
- If same answer produced for k=10 consecutive chunks → converged
- Reduces token usage by **up to 40%** without accuracy loss

**Answer Convergence Ratio (ACR)**:
- Metric: proportion of reasoning steps needed before predictions stabilize
- Average: 60% for math tasks → substantial redundancy in full chains
- **Implication**: Can stop early when convergence detected

**Learn-to-Stop Approach**:
- Train classifier to predict optimal stopping points
- Threshold τ tuned on validation (0.50-0.99 depending on task difficulty)

### 3. Multi-Agent Coordination Patterns

**Single-Agent Pattern**:
- One LLM handles entire pipeline sequentially
- Simpler but less parallelizable
- Examples: DeepResearcher, WebThinker

**Multi-Agent Pattern** (RECOMMENDED):
- Specialized agents assigned to stages:
  - **Planner agents**: Task decomposition
  - **Query agents**: Generating search queries
  - **Retriever agents**: Interacting with external tools
  - **Writer agents**: Structured synthesis
- Enables parallel execution

### 4. Quality Metrics for Research Completion

| Metric | Description |
|--------|-------------|
| **Structure Control** | Planning-based generation, constraint-guided output |
| **Factual Integrity** | Faithful to retrieved evidence, cross-source consistency |
| **Knowledge Precision** | Accuracy of extracted information |
| **Knowledge Recall** | Completeness of coverage |
| **Agreement Score** | Consensus across sources |

### 5. Iterative Refinement Techniques

- **ReAct Pattern**: Interleave reasoning traces with task-specific actions
- **Curriculum Training**: Progress through increasingly complex tasks
- **Self-Improvement**: Learn from deployment experience without human intervention
- **Adaptive Query Strategies**: RL-based query refinement

---

## Recommended Design for /dev:research Command

### Finalization Criteria (Convergence-Based)

```
STOP when ANY of:
1. Answer Convergence: k=3 consecutive synthesis attempts produce same key findings
2. Information Saturation: No new relevant information in last 2 search iterations
3. Source Coverage: Minimum 5-10 high-quality sources retrieved
4. Time Budget: Maximum iterations reached (default: 10)
5. User Satisfaction: Manual approval received
```

### Parallel Research Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR                             │
│  - Manages research state                                    │
│  - Tracks convergence metrics                                │
│  - Coordinates parallel agents                               │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  PLANNER    │      │  EXPLORER   │      │  EXPLORER   │
│  Agent      │      │  Agent 1    │      │  Agent N    │
│  (Gemini)   │      │  (Gemini)   │      │  (Gemini)   │
└─────────────┘      └─────────────┘      └─────────────┘
         │                    │                    │
         │                    ▼                    ▼
         │           ┌─────────────────────────────┐
         │           │    FINDINGS FILES           │
         │           │  - findings-1.md            │
         │           │  - findings-2.md            │
         │           │  - findings-N.md            │
         │           └─────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    SYNTHESIZER Agent                         │
│  - Collects all findings files                               │
│  - Checks convergence criteria                               │
│  - Produces final report                                     │
└─────────────────────────────────────────────────────────────┘
```

### Model Fallback Strategy

```
Priority Order:
1. Gemini 3 Flash Preview (google/gemini-exp-1206 via GOOGLE_API_KEY)
2. Gemini via OpenRouter (google/gemini-2.5-flash via claudish)
3. Haiku (claude-haiku via native)
```
