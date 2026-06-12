import type { NavItem, PageType } from "./types.ts";

export interface RenderInput {
  /** absolute path of the source markdown file */
  sourcePath: string;
  /** absolute path to the pandoc/ design root */
  pandocDir: string;
  pageType: PageType;
  nav: NavItem[];
  /** site-wide MathJax macro map (name → TeX), from _data/math-macros.yaml */
  mathMacros: Record<string, string>;
}

/**
 * Render one page to standalone HTML (O5) by invoking the system pandoc
 * with the page type's defaults file and template. Pandoc failures throw
 * BuildError(kind="pandoc").
 */
export async function renderPage(input: RenderInput): Promise<string> {
  void input;
  throw new Error("not implemented");
}
