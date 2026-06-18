import http from "node:http";

export function createE2eContentServer(routes) {
  const server = http.createServer((request, response) => {
    const pathname = request.url?.split("?")[0] ?? "/";
    const route = routes[pathname];
    if (!route) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const body = typeof route.body === "function" ? route.body() : route.body;
    const contentType = route.contentType ?? "text/plain; charset=utf-8";
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(body);
  });

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve e2e content server port");
      }
      return { baseUrl: `http://127.0.0.1:${address.port}` };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
