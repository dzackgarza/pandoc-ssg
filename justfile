[doc("Run commit-tier Bun QC through the central implementation.")]
test-commit:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-commit

[doc("Run the full Bun test suite before pushing.")]
test-push:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-push

[doc("Run CI acceptance QC through the central implementation.")]
test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci
