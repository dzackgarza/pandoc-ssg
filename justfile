# -d . keeps QC running against this repo: bare `just -f` would set the
# working directory to ~/ai-review-ci/justfiles and preflight the wrong tree.
# ai-review-ci contract variables consumed by doctor and workflow installers.
ai_review_ci_schema_version := "1"
ai_review_ci_profile := "bun"
ai_review_ci_ref := "main"
ai_review_ci_release_channel := "main"
ai_review_ci_workflow_template_version := "1"
ai_review_ci_local_delegation := "global-justfile"
ai_review_ci_default_branch := "main"

test:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test

test-ci:
    @just -f ~/ai-review-ci/justfiles/bun.just -d . test-ci
