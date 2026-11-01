/**
 * index-descriptor.ts — what an engine declares about its on-disk index so a new git
 * worktree can start from a copy of the main tree's index.
 *
 * Types only. Engine knowledge (which files, which SQL) lives in `adapters/catalog.ts`
 * and fills these in; nothing generic names an engine.
 */

/** Shared vocabulary of the worktree modules. */
export type Env = Readonly<Record<string, string | undefined>>;
/** `lstat`, no symlink follow: a symlink is "other". */
export type FileKind = "file" | "directory" | "missing" | "other";

export type IndexStore = "sqlite" | "file";

export interface IndexState {
  /** false = unsafe to copy. */
  complete: boolean;
  /** Commit the index was built at. */
  commit?: string;
  /** Paths indexed with uncommitted content. */
  dirtyPaths?: readonly string[];
}

/** Read-only handle on an index root (opened normally read-only). */
export interface IndexSource {
  exists(rel: string): boolean;
  sqlite(rel: string): { query(sql: string): readonly (readonly unknown[])[] } | undefined;
  json(rel: string): unknown | undefined;
  close(): void;
}

export interface CopyRecipe {
  store: IndexStore;
  /** Files relative to the PROJECT DIR, in copy order. The LAST entry is the marker (= IndexDescriptor.path). */
  include: readonly string[];
  /** Never throws; complete:false on doubt. A copyable engine records both `commit` and `dirtyPaths`;
   *  inspect() returns complete:false when either is unrecorded. rel is relative to the root given to openIndexSource. */
  inspect(source: IndexSource): IndexState;
  /** The declared `update` re-indexes a file whose CONTENT changed, and on an unchanged fresh copy touches
   *  zero files (both measured; otherwise the engine is not copyable). */
  updateRefreshesModified: true;
  /** Would the engine index this project-relative path of this size (bytes, undefined = unknown)?
   *  Gitignore is git's concern. Verification checks only paths for which this is true. */
  isIndexable(rel: string, sizeBytes: number | undefined): boolean;
  /** Every indexed path, or undefined when the store cannot enumerate. */
  indexedFiles(source: IndexSource): ReadonlySet<string> | undefined;
  /** The engine's OWN incremental command, literal argv (no placeholder), cwd = the project dir. */
  update: readonly string[];
}

export type IndexDescriptor =
  | { worktrees: "engine-managed"; path: string } // path = projectStep.marker
  | {
      worktrees: "copy";
      path: string;
      /** Project-relative files/directories the engine writes for its index (includes `path`). The rollback
       *  ALLOWLIST: rollback deletes these and nothing else. */
      owned: readonly string[];
      paths: "relative";
      incremental: true;
      copy: CopyRecipe;
    };
