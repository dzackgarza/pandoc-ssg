# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Extract MathJax 3 macros live from LaTeX macro sources and emit them as JSON.

This is the SSG's bundled, vendored extraction *script* (not a vendored macro
set): it reads a canonical manifest declaring which .tex files feed MathJax,
parses their \\newcommand / \\def / \\DeclareMathOperator definitions, and writes
the MathJax 3 tex.macros map to stdout as JSON. The site build runs it every
compile so the macros always reflect the live source — nothing is stored.

MathJax 3 tex.macros format:
  - Zero-arg macros:  "Name": "replacement"
  - N-arg macros:     "Name": ["replacement with #1..#n", N]

Usage:
  uv run extract_mathjax_macros.py <manifest-path>

The manifest lists one macro-file path per line (relative to the manifest's
directory), '#'-comments and blank lines ignored. A missing manifest or a
missing listed file is a hard error (exit 1) — never a silent empty result.
"""

import json
import re
import sys
from pathlib import Path
from typing import NamedTuple


class MacroDef(NamedTuple):
    name: str
    arg_count: int
    body: str


# Shims for MathJax-only primitives the LaTeX sources assume from packages.
MATHJAX_SHIMS = (
    MacroDef("coloneqq", 0, r"\mathrel{\vcenter{:}}="),
    MacroDef("qty", 1, r"\left( {#1} \right)"),
)

DEF_CMD_RE = re.compile(
    r"""
    \\
    (?:newcommand|renewcommand|providecommand
      |DeclareMathOperator|DeclarePairedDelimiter
      |def
    )\*?
    """,
    re.VERBOSE | re.DOTALL,
)

_COMMENT_OR_EMPTY = re.compile(r"^\s*(%.*|\s*)$")
_EXCLUDE_STARTSWITH = (
    "\\NeedsTeXFormat",
    "\\ProvidesPackage",
    "\\usepackage",
    "\\makeatletter",
    "\\makeatother",
    "\\endinput",
    "\\input{",
)


def _strip_comments_and_boilerplate(content: str) -> str:
    lines: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if _COMMENT_OR_EMPTY.match(stripped):
            continue
        if stripped.startswith(_EXCLUDE_STARTSWITH):
            continue
        lines.append(line)
    return "\n".join(lines)


def _merge_continuations(raw: str) -> str:
    lines = raw.splitlines()
    merged: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.rstrip().endswith("%") and i + 1 < len(lines):
            line = line.rstrip()[:-1]
            i += 1
            line += " " + lines[i].lstrip()
        merged.append(line)
        i += 1
    return "\n".join(merged)


def _skip_ws(raw: str, pos: int) -> int:
    while pos < len(raw) and raw[pos] in " \t\n\r":
        pos += 1
    return pos


def _extract_balanced_group(raw: str, pos: int) -> tuple[str, int]:
    assert pos < len(raw) and raw[pos] == "{", (
        f"expected '{{' at pos {pos}, got {raw[pos : pos + 10]!r}"
    )
    depth = 0
    start = pos
    while pos < len(raw):
        ch = raw[pos]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return raw[start + 1 : pos], pos + 1
        elif ch == "\\":
            pos += 1
        pos += 1
    return raw[start + 1 : pos], pos


def _extract_name(raw: str, pos: int) -> tuple[str, int]:
    pos = _skip_ws(raw, pos)
    if pos >= len(raw):
        return "", pos
    if raw[pos] == "{" and pos + 1 < len(raw) and raw[pos + 1] == "\\":
        inner, after = _extract_balanced_group(raw, pos)
        assert inner.startswith("\\"), f"expected \\ name in braces, got {inner!r}"
        return inner[1:], after
    if raw[pos] == "\\":
        end = pos + 1
        while end < len(raw) and raw[end].isalpha():
            end += 1
        return raw[pos + 1 : end], end
    return "", pos


def _extract_opt_arg_count(raw: str, pos: int) -> tuple[int, int]:
    pos = _skip_ws(raw, pos)
    if pos < len(raw) and raw[pos] == "[":
        close = raw.find("]", pos)
        if close != -1:
            n = int(raw[pos + 1 : close])
            return n, close + 1
    return 0, pos


def _extract_body(raw: str, pos: int) -> tuple[str, int]:
    pos = _skip_ws(raw, pos)
    if pos >= len(raw) or raw[pos] != "{":
        return "", pos
    return _extract_balanced_group(raw, pos)


def parse_macros(content: str) -> list[MacroDef]:
    text = _strip_comments_and_boilerplate(content)
    text = _merge_continuations(text)

    macros: list[MacroDef] = []
    pos = 0
    while True:
        m = DEF_CMD_RE.search(text, pos)
        if not m:
            break
        cmd = m.group(0).lstrip("\\").rstrip("*")
        pos = m.end()
        pos = _skip_ws(text, pos)

        if "DeclarePairedDelimiter" in cmd:
            _name, pos = _extract_name(text, pos)
            _l, pos = _extract_body(text, pos)
            _r, pos = _extract_body(text, pos)
            continue

        name, pos = _extract_name(text, pos)
        if not name:
            continue
        arg_count, pos = _extract_opt_arg_count(text, pos)
        body, pos = _extract_body(text, pos)
        body = body.strip()
        if not body:
            continue
        if "DeclareMathOperator" in cmd:
            body = f"\\operatorname{{{body}}}"
            arg_count = 0
        macros.append(MacroDef(name=name, arg_count=arg_count, body=body))
    return macros


def _unique_macros(macros: list[MacroDef]) -> list[MacroDef]:
    """First definition wins (later providecommand aux files do not override)."""
    seen: set[str] = set()
    unique: list[MacroDef] = []
    for macro in macros:
        if macro.name in seen:
            continue
        seen.add(macro.name)
        unique.append(macro)
    return unique


def _read_manifest(manifest_path: Path) -> list[Path]:
    if not manifest_path.exists():
        print(f"ERROR: macro manifest not found: {manifest_path}", file=sys.stderr)
        sys.exit(1)
    base = manifest_path.parent
    files: list[Path] = []
    for line in manifest_path.read_text().splitlines():
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            continue
        resolved = (base / stripped).resolve()
        if not resolved.exists():
            print(
                f"ERROR: macro file listed in {manifest_path.name} not found: {resolved}",
                file=sys.stderr,
            )
            sys.exit(1)
        files.append(resolved)
    if not files:
        print(f"ERROR: manifest declares no macro files: {manifest_path}", file=sys.stderr)
        sys.exit(1)
    return files


def _to_mathjax(macros: list[MacroDef]) -> dict[str, object]:
    obj: dict[str, object] = {}
    for m in macros:
        obj[m.name] = m.body if m.arg_count == 0 else [m.body, m.arg_count]
    return obj


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: extract_mathjax_macros.py <manifest-path>", file=sys.stderr)
        sys.exit(2)
    manifest_path = Path(sys.argv[1]).expanduser()
    source_files = _read_manifest(manifest_path)
    macros: list[MacroDef] = list(MATHJAX_SHIMS)
    for source_file in source_files:
        macros.extend(parse_macros(source_file.read_text()))
    macros = _unique_macros(macros)
    json.dump(_to_mathjax(macros), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
