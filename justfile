# -d . keeps QC running against this repo: bare `just -f` would set the
# working directory to ~/ai-review-ci/justfiles and preflight the wrong tree.
# Run commit-tier Bun QC through the central implementation.
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

# Run the full Bun test suite before pushing.
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

# Run CI acceptance QC through the central implementation.
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci
