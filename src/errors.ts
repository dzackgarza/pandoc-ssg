import { parse } from "smol-toml";

export type BuildErrorKind =
  | "config"
  | "schema"
  | "route-collision"
  | "nav"
  | "pandoc"
  | "scaffold"
  | "verify"
  | "deploy";

/**
 * Structured build failure. Tests and callers discriminate on `kind` and the
 * offending `files`, never on message text.
 */
export class BuildError extends Error {
  readonly kind: BuildErrorKind;
  readonly code: BuildErrorKind;
  /** content-relative paths of the offending source file(s) */
  readonly files: string[];
  readonly details: { files: string[] };

  constructor(kind: BuildErrorKind, files: string[], message: string, cause?: unknown) {
    if (cause === undefined) {
      super(message);
    } else {
      super(message, { cause });
    }
    this.name = "BuildError";
    this.kind = kind;
    this.code = kind;
    this.files = files;
    this.details = { files };
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function parseToml(
  raw: string,
  kind: BuildErrorKind,
  file: string,
  label: string,
): unknown {
  try {
    return parse(raw);
  } catch (err) {
    let detail = err instanceof Error ? err.message : String(err);
    throw new BuildError(kind, [file], `malformed ${label}: ${detail}`, err);
  }
}
