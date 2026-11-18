const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
  } catch (_) {
    response.writeHead(400).end("Bad request");
    return;
  }
  const relative = pathname.replace(/^[/\\]+/, "") || "index.html";
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(filename, (statError, stat) => {
    if (statError) {
      response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
      return;
    }
    const target = stat.isDirectory() ? path.join(filename, "index.html") : filename;
    fs.readFile(target, (readError, body) => {
      if (readError) {
        response.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(body);
    });
  });
});

server.on("error", error => {
  console.error(`Preview server error on 127.0.0.1:${port}: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Portfolio OS preview listening on http://127.0.0.1:${port}`);
});
