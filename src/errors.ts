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
  declare readonly kind: BuildErrorKind;
  /** content-relative paths of the offending source file(s) */
  declare readonly files: string[];

  constructor(kind: BuildErrorKind, files: string[], message: string, cause: unknown | false = false) {
    super(message);
    return createBuildError(kind, files, message, cause);
  }
}

function createBuildError(
  kind: BuildErrorKind,
  files: string[],
  message: string,
  cause: unknown | false,
): BuildError {
  let error = cause === false ? new Error(message) : new Error(message, { cause });
  Object.setPrototypeOf(error, BuildError.prototype);
  Object.defineProperties(error, {
    name: { value: "BuildError", configurable: true },
    kind: { value: kind, enumerable: true, configurable: true },
    files: { value: files, enumerable: true, configurable: true },
  });
  return error as BuildError;
}
