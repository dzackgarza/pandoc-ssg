---
title: Diagram
site:
  page: true
  schema: page.v1
---

# A diagram

A simple commutative square:

\begin{tikzcd}
A \arrow[r, "f"] & B
\end{tikzcd}

:::{.definition title="Widgets"}
For an object $x$, a *widget* is a diagram
\begin{tikzcd}
x \arrow[r, "u"] & y
\end{tikzcd}
:::

:::{.theorem}
Every widget admits a unique completion.
:::

:::{.remark}
The completion is functorial.
:::
