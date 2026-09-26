# OpenAPI and Apidog

An OpenAPI document describes the service's contract for everyone who does not read its code:
frontend teams, generated clients, API gateways, and tools such as Apidog. It is only useful while
it matches the routes, so the rules below are about keeping it true, not about writing it once.

## Keep the spec next to the routes

- **One spec file per service, committed** (`openapi.yaml` or `openapi.json`), versioned with the
  code it describes. A spec that lives only in a SaaS tool drifts on the first refactor.
- **Derive the schemas from the validators you already have.** If request bodies are validated
  with a schema library (`errors/references/validation-boundaries.md`), generate the OpenAPI
  schemas from those definitions instead of retyping them. Two hand-written copies disagree within
  a release.
- **Field names in the spec are the field names on the wire.** They follow `api-design.md`
  ("Field naming and shape"), whatever the database columns are called.
- **Document the error shape once**, as a shared component, and reference it from every
  operation's `4xx`/`5xx` responses. It is the envelope `toResponse()` in the `errors` skill
  produces (`api-design.md`, "Errors").
- **Validate the spec in CI** with an OpenAPI linter, and fail the build on errors. A spec that
  does not parse is worse than none, because tools import it partially.

## Apidog

Apidog imports an OpenAPI document into a project, where it becomes docs, mocks and test cases.

**Credentials** come from the environment, parsed at boot like any other config
(`project-setup`), never committed:

| Variable | Where it comes from |
|---|---|
| `APIDOG_PROJECT_ID` | the Apidog project's settings |
| `APIDOG_API_TOKEN` | the Apidog account's API token settings |

**Apidog extensions** on an operation organise the imported result:

| Extension | Meaning |
|---|---|
| `x-apidog-folder` | folder path in the project, levels separated by `/` (escape a literal `/` as `\/`) |
| `x-apidog-status` | lifecycle status, for example `designing`, `developing`, `testing`, `released`, `deprecated` |
| `x-apidog-maintainer` | the Apidog user who owns the endpoint |

**Import the spec** as a Bun script, so the payload is built by `JSON.stringify` and not by shell
quoting (a spec embedded in a shell string breaks on its first `"`):

```ts
// scripts/apidog-import.ts — bun scripts/apidog-import.ts openapi.json
const [specPath] = Bun.argv.slice(2);
const projectId = Bun.env.APIDOG_PROJECT_ID;
const token = Bun.env.APIDOG_API_TOKEN;
if (!specPath || !projectId || !token) {
  console.error("usage: apidog-import.ts <spec.json>; needs APIDOG_PROJECT_ID and APIDOG_API_TOKEN");
  process.exit(2);
}

const res = await fetch(`https://api.apidog.com/v1/projects/${projectId}/import-openapi`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "X-Apidog-Api-Version": "2024-03-28",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    input: await Bun.file(specPath).text(),
    options: { endpointOverwriteBehavior: "AUTO_MERGE", schemaOverwriteBehavior: "AUTO_MERGE" },
  }),
});

const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`import failed: HTTP ${res.status}`, body);
  process.exit(1);
}
console.log(body?.data?.counters ?? body);
if (body?.data?.errors?.length) process.exit(1); // a 200 can still carry per-endpoint errors
```

- The overwrite behaviours are `AUTO_MERGE`, `OVERWRITE_EXISTING`, `KEEP_EXISTING` and
  `CREATE_NEW`. `AUTO_MERGE` keeps edits made in Apidog; `OVERWRITE_EXISTING` makes the committed
  spec the only authority.
- A `401` is a bad or expired token, a `404` a wrong project id, and a `422` a spec Apidog rejected.
  Read `data.errors` even on success: a partial import still answers `200`.
- The endpoint, the version header and the option names follow Apidog's public API as documented
  when this reference was written. If a call fails with a `4xx` that the table does not explain,
  check Apidog's current API reference before changing the payload.
