## GTD Task Management

### Task Storage

Tasks are stored in `.claude/gtd/tasks.json` (project-local, git-committable).
Weekly review summaries go to `.claude/gtd/reviews/`.

### Task File Format

```json
{
  "tasks": [
    {
      "id": "t-001",
      "subject": "Task title",
      "list": "inbox|next|waiting|project|someday|reference",
      "created": "ISO-8601",
      "completed": null,
      "dueDate": null,
      "parentId": null
    }
  ]
}
```

### Commands

Use `/gtd:capture` to add tasks, `/gtd:clarify` to process inbox, `/gtd:engage` for next actions,
`/gtd:review` for weekly review, `/gtd:status` for overview.
