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
  /** page type registry resolved from the bundled registry plus content overrides */
  pageTypes: Record<string, PageType>;
  /** frontmatter schema registry resolved from the bundled registry plus content overrides */
  schemas: Record<string, SchemaDefinition>;
  /** declared component handlers; C3 owns dispatch migration */
  componentHandlers: Record<string, ComponentHandler>;
  /** declared interactive island entries; C3 owns dispatch migration */
  islands: Record<string, IslandEntry>;
  /** generated artifact rules; C4 owns manifest dependency metadata */
  generatedArtifacts: GeneratedArtifactRule[];
  /** site-wide Lua filters applied to every rendered page */
  filters?: RegistryFile[];
}

export type RegistrySource = "pandoc" | "content";

export interface RegistryFile {
  path: string;
  source?: RegistrySource;
}

export interface PageScaffold {
  alias?: string;
  dir: string;
  filename: string;
  fields?: Record<string, string>;
}

/** A registered page type: schema + template/default/filter/scaffold contract. */
export interface PageType {
  name: string;
  schema: string;
  template: string;
  defaults: string;
  filters?: RegistryFile[];
  scaffold?: PageScaffold;
  feed?: "blog";
  source?: RegistrySource;
}

export type SchemaFieldType = "string" | "date" | "string[]";

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
}

export interface SchemaDefinition {
  fields: SchemaField[];
}

export interface ComponentHandler {
  handler: string;
  module?: RegistryFile;
  island?: string;
}

export interface IslandEntry {
  entry: string;
  output: string;
  source?: RegistrySource;
  dataOutput?: string;
  dataSource?: "blog-posts" | "items";
  mount?: string;
}

export interface GeneratedArtifactRule {
  kind: GeneratedEntry["kind"];
  source?: string;
  output: string;
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
  /** Absent on a pure dropdown parent (a label whose only job is to group children). */
  href?: string;
  weight: number;
  /** Nested entries, for dropdown menus. Arbitrary depth. */
  children?: NavItem[];
}

export interface BuildOptions {
  /** absolute path to the content/ authoring root */
  contentDir: string;
  /** absolute path to the pandoc/ design root (defaults, templates, filters) */
  pandocDir: string;
  /** absolute path of the output tree (dist/) */
  outDir: string;
}
