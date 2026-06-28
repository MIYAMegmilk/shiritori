import { serveDir } from "@std/http/file-server";

const PORT = 8000;

Deno.serve({ port: PORT }, (req) => {
  // public/ 以下を静的配信する
  return serveDir(req, {
    fsRoot: "public",
    quiet: true,
  });
});

console.log(`しりとりサーバー起動: http://localhost:${PORT}`);
