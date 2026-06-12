# -d . keeps QC running against this repo: bare `just -f` would set the
# working directory to ~/ai-review-ci/justfiles and preflight the wrong tree.
test:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test

test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci
