import { createServer } from "node:http";
import sirv from "sirv";

export interface ServeOptions {
  outDir: string;
  port?: number;
}

export interface RunningServer {
  port: number;
  stop(): boolean;
}

function requestedPort(port: number | undefined): number {
  if (port === undefined) {
    return 0;
  }
  return port;
}

/**
 * Static preview server over a built dist tree. sirv owns the static serving —
 * directory-index resolution, content types, and path-traversal protection;
 * `dev: true` disables caching so a rebuilt file is served fresh. Resolves once
 * the server is listening (so `port` is bound).
 */
export function startServer(opts: ServeOptions): Promise<RunningServer> {
  let serve = sirv(opts.outDir, { dev: true });
  let server = createServer((req, res): boolean => {
    serve(req, res, (): Promise<void> => {
      res.statusCode = 404;
      res.end("Not Found");
      return Promise.resolve();
    });
    return true;
  });

  return new Promise((resolve, reject): boolean => {
    server.on("error", reject);
    server.listen(requestedPort(opts.port), (): boolean => {
      let address = server.address();
      if (!address) {
        server.close();
        reject(new Error("preview server did not report a bound TCP port"));
        return true;
      }
      if (typeof address === "string") {
        server.close();
        reject(new Error("preview server did not report a bound TCP port"));
        return true;
      }
      resolve({
        port: address.port,
        stop: (): boolean => {
          server.close();
          return true;
        },
      });
      return true;
    });
    return true;
  });
}
