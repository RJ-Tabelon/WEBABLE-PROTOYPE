import { createServer } from 'node:http';

const html = `<!doctype html>
<html lang="en">
  <head><title>WebAble test article</title></head>
  <body>
    <main>
      <h1>Extension test page</h1>
      <p>This content should be visible inside the WebAble popup.</p>
      <p id="tiny" style="font-size: 10px; line-height: 10px">Small text</p>
      <p style="display: none">Hidden text must not be read.</p>
      <label>Email <input value="private@example.com" /></label>
      <a href="/more">Read more</a>
      <button>Continue</button>
    </main>
  </body>
</html>`;

createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(4173, '127.0.0.1');
