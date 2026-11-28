import { expect } from "bun:test";
import { BuildError, type BuildErrorKind } from "../src/errors.ts";

export async function expectBuildError(
  action: Promise<unknown> | (() => unknown),
  expected: { kind: BuildErrorKind; files?: string[] },
): Promise<void> {
  const rejection = typeof action === "function" ? Promise.resolve().then(action) : action;
  await expect(rejection).rejects.toThrow(BuildError);
  await expect(rejection).rejects.toMatchObject({ name: "BuildError", ...expected });
}
