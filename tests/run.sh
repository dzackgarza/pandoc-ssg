#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

kernel=()
isolated=()
for file in tests/*.test.ts; do
    case "$file" in
        tests/amsthm-label-font.test.ts|tests/post-toc-font.test.ts|tests/theme-colorscheme.test.ts|\
        tests/collection.test.ts|tests/blog-island.test.ts|tests/verify.test.ts|\
        tests/cli.test.ts|tests/shots.test.ts)
            isolated+=("$file")
            ;;
        *)
            kernel+=("$file")
            ;;
    esac
done

bun test --coverage --coverage-reporter=lcov --coverage-dir=. "${kernel[@]}" "$@"
for file in "${isolated[@]}"; do
    bun test "$file" "$@"
done
