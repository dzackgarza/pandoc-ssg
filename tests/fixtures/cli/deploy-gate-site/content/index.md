---
site:
  page: true
  schema: page.v1
title: Home
---

# Welcome

This paragraph leaks un-migrated Liquid: {% include broken.html %} which the
browser verify flags as unresolved-markup, so the deploy gate must refuse to
publish this page.
