import { join, normalize } from "node:path";

export interface ServeOptions {
  outDir: string;
  port?: number;
}

export interface RunningServer {
  port: number;
  stop(): void;
}

/**
 * Resolve a decoded request pathname to the candidate file paths (relative to
 * outDir) to try, in order. Returns an empty list for traversal attempts so
 * the caller can answer 404 without ever touching the filesystem.
 *
 * - `/`        → ["index.html"]
 * - `/p/`      → ["p/index.html"]
 * - `/p`       → ["p", "p/index.html"]   (file first, then directory index)
 * - `/file.ext`→ ["file.ext"]
 */
function candidatesFor(pathname: string): string[] {
  if (pathname.includes("..")) {
    return [];
  }
  // strip the leading slash; "" means the site root
  let rel = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (rel === "") {
    return ["index.html"];
  }
  if (rel.endsWith("/")) {
    return [`${rel}index.html`];
  }
  return [rel, `${rel}/index.html`];
}

async function resolveFile(outDir: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    let full = join(outDir, candidate);
    // Defense in depth: a resolved path must stay inside outDir.
    let normalized = normalize(full);
    if (normalized !== outDir && !normalized.startsWith(`${outDir}/`)) {
      continue;
    }
    if (await Bun.file(full).exists()) {
      return full;
    }
  }
  return undefined;
}

export function startServer(opts: ServeOptions): RunningServer {
  // Normalize once so the containment guard compares like-for-like: the CLI
  // passes a relative, "./"-prefixed dir ("dist"), and join() strips the "./",
  // so an un-normalized outDir would never match its own resolved children.
  let outDir = normalize(opts.outDir);
  let listenPort = opts.port === undefined ? 0 : opts.port;

  let server = Bun.serve({
    port: listenPort,
    async fetch(req: Request): Promise<Response> {
      if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let pathname = decodeURIComponent(new URL(req.url).pathname);
      let candidates = candidatesFor(pathname);
      let resolved = await resolveFile(outDir, candidates);

      if (resolved === undefined) {
        return new Response("Not Found", { status: 404 });
      }

      // Bun sets Content-Type from the file extension (its built-in MIME db).
      return new Response(Bun.file(resolved));
    },
  });

  let boundPort = server.port;
  if (boundPort === undefined) {
    server.stop(true);
    throw new Error("Bun.serve did not report a bound port");
  }

  return {
    port: boundPort,
    stop(): void {
      server.stop(true);
    },
  };
}
