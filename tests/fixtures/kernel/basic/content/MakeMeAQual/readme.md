---
site:
  page: true
  schema: page.v1
title: "Embedded readme that still must not compile"
---

# Inside an opaque subtree

Even though this carries site.page: true, it lives under an opaque passthrough
subtree and must classify as opaque (copied verbatim, never compiled).
