---
name: repl
description: Open an interactive REPL or database shell session. Handles prompt detection, query execution, and clean exit for psql, mongosh, redis-cli, python3, node, and other REPLs.
allowed-tools: mcp__ht__ht_create_session, mcp__ht__ht_execute_command, mcp__ht__ht_send_keys, mcp__ht__ht_take_snapshot, mcp__ht__ht_close_session, mcp__ht__ht_list_sessions
---

# /terminal:repl

Open an interactive REPL or database shell, execute queries/expressions, and manage the session lifecycle.

## Usage

```
/terminal:repl {application} [query]
```

## Examples

**Database shells**:
```
/terminal:repl psql $DATABASE_URL
/terminal:repl "psql -d myapp" "SELECT count(*) FROM users"
/terminal:repl mongosh $MONGO_URI
/terminal:repl redis-cli
/terminal:repl "turso db shell mydb"
```

**Language REPLs**:
```
/terminal:repl python3
/terminal:repl node
/terminal:repl "bun repl"
/terminal:repl irb
```

## What It Does

1. **Creates** an ht-mcp session
2. **Launches** the REPL application
3. **Waits** for the REPL prompt using prompt detection patterns:
   - psql: `=#` or `=>` at end of line
   - mongosh: `>` after connection banner
   - redis-cli: `127.0.0.1:6379>`
   - python3: `>>>` at end of line
   - node/bun: `>` at end of line
   - irb: `irb>` or `irb(main)`
4. **Executes queries** if provided in the command
5. **Takes snapshots** to capture results
6. **Exits cleanly** using the appropriate exit command for each REPL
7. **Closes** the session

## REPL Exit Commands

| Application | Exit Command |
|-------------|-------------|
| psql | `\q` + Enter |
| mongosh | `.exit` + Enter or `^d` |
| redis-cli | `quit` + Enter or `^d` |
| python3 | `exit()` + Enter or `^d` |
| node / bun | `.exit` + Enter or `^d` |
| irb | `exit` + Enter or `^d` |
| turso shell | `.quit` + Enter |

## Multi-Query Sessions

If the user wants to run multiple queries, execute them sequentially:

```
1. Send first query + Enter
2. Take snapshot to capture result
3. Wait for prompt to return
4. Send next query + Enter
5. Take snapshot
6. ... repeat ...
7. Exit cleanly
```

## 40-Line Rule for Database Queries

Always add row limits to database queries to stay within the 120x40 snapshot window:

```sql
-- Good: limited results fit on screen
SELECT * FROM users ORDER BY id LIMIT 20;

-- Bad: unlimited results will scroll off screen
SELECT * FROM users;
```

## Safety

- **Never send passwords**: If a password prompt is detected, STOP and report to the user
- **Confirm destructive operations**: DROP TABLE, DELETE, TRUNCATE — always ask first
- **Use LIMIT**: Always limit query results to fit within 40-line snapshot

## Notes

- REPL sessions are inherently multi-turn — the session stays open until explicitly exited
- If context is compacted and the session ID is lost, use `/terminal:observe` to find it
- For one-shot commands (not interactive), use `/terminal:run` instead
- For TUI navigation (vim, lazygit), use `/terminal:tui` instead
