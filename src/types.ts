/** Classification of a file under content/ — exactly one class per file (O1). */
export type FileClass = "reserved" | "page" | "asset" | "opaque";

export interface ClassifiedFile {
  /** POSIX path relative to content/ */
  relPath: string;
  class: FileClass;
}

/** Parsed content/_site.toml. */
export interface SiteConfig {
  /** content-relative directories copied verbatim with no compilation */
  passthrough: { path: string }[];
  /** directory (content-relative prefix) → page type name inference (O8) */
  dirTypes: { dir: string; type: string }[];
}

/** A registered page type: schema + template pairing. */
export interface PageType {
  name: string;
  schema: string;
  template: string;
}

/** Validated frontmatter common to all pages. */
export interface PageMeta {
  title: string;
  site: {
    page: true;
    schema?: string;
    type?: string;
    route?: string;
  };
  date?: string;
  tags?: string[];
  categories?: string[];
}

export interface RouteEntry {
  source: string;
  url: string;
  output: string;
  type: string;
  schema: string;
}

export interface PassthroughEntry {
  source: string;
  output: string;
}

/**
 * A file the build synthesizes (not copied from content, not a pandoc route):
 * the blog-index island's data (`blog/posts.json`) and its Svelte bundle
 * (`assets/islands/blog-index.js`). Tracked so O6's bijection still holds (O16).
 */
export interface GeneratedEntry {
  output: string;
  kind: "data" | "island" | "theme";
}

export interface Manifest {
  schemaVersion: 1;
  routes: RouteEntry[];
  passthrough: PassthroughEntry[];
  generated: GeneratedEntry[];
}

export interface NavItem {
  title: string;
  href: string;
  weight: number;
  external?: boolean;
}

export interface BuildOptions {
  /** absolute path to the content/ authoring root */
  contentDir: string;
  /** absolute path to the pandoc/ design root (defaults, templates, filters) */
  pandocDir: string;
  /** absolute path of the output tree (dist/) */
  outDir: string;
}
