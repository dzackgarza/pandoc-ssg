export type BuildErrorKind =
  | "config"
  | "schema"
  | "route-collision"
  | "nav"
  | "pandoc"
  | "scaffold"
  | "verify";

/**
 * Structured build failure. Tests and callers discriminate on `kind` and the
 * offending `files`, never on message text.
 */
export class BuildError extends Error {
  readonly kind: BuildErrorKind;
  /** content-relative paths of the offending source file(s) */
  readonly files: string[];

  constructor(kind: BuildErrorKind, files: string[], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BuildError";
    this.kind = kind;
    this.files = files;
  }
}
