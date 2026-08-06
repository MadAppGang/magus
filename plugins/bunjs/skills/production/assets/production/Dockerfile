# Multi-stage Bun image.
#
# Pin the version. `oven/bun:latest` means a runtime upgrade reaches production without a
# code change — both a reliability and a security event, and impossible to bisect later.
FROM oven/bun:1.3.10-alpine AS deps

WORKDIR /app

# Copy ONLY the manifests first. This layer is cached until a dependency actually
# changes, so an ordinary source edit skips the install entirely. Copying source first
# (the common mistake) reinstalls every dependency on every build.
COPY package.json bun.lock ./

# --frozen-lockfile fails rather than silently resolving something new, so the image
# contains exactly what was reviewed. Without it CI can install an unreviewed version.
RUN bun install --frozen-lockfile --production


# --- build stage: dev dependencies present, so typecheck and tests can run ---
FROM oven/bun:1.3.10-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

# `bun run` strips types without checking them, so a type error never surfaces at runtime.
# Failing the build here is the only place it gets caught.
RUN bun run typecheck && bun test

# Bundling to a single file means the runtime image needs no node_modules at all.
RUN bun build src/index.ts --target=bun --outdir=dist --minify


# --- runtime: smallest surface that can run the app ---
FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app

# The oven/bun images already ship a non-root `bun` user. Running as root means a
# container escape or a dependency compromise starts with full privileges.
ENV NODE_ENV=production

COPY --from=build --chown=bun:bun /app/dist ./dist

# tini as PID 1: without an init, PID 1 has no default signal handlers, so SIGTERM is
# IGNORED unless your process explicitly handles it — and any handler bug means the
# orchestrator waits out its full grace period and then SIGKILLs you mid-write.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

USER bun

EXPOSE 3000

# Exec form (no shell) so signals reach the process directly. The shell form
# (`CMD bun run ...`) puts /bin/sh at PID 1's child and swallows SIGTERM.
CMD ["bun", "run", "dist/index.js"]

# Deliberately NO HEALTHCHECK here: in Kubernetes the readiness and liveness probes are
# defined in the manifest, and a Docker HEALTHCHECK is ignored. Add one only for plain
# Docker or Compose deployments:
#   HEALTHCHECK --interval=10s --timeout=2s --retries=3 \
#     CMD bun -e "fetch('http://localhost:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
