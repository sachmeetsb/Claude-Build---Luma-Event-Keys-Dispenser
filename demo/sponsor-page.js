// Stand-in for the real promo destination during demos, so the actual offer URL never appears on video.
import http from 'node:http';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sponsor credits (demo)</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#1a1815;font:18px/1.5 -apple-system,Inter,sans-serif}
.c{max-width:520px;padding:40px;border-radius:18px;background:#fff;box-shadow:0 10px 40px rgba(0,0,0,.08);text-align:center}
h1{font-size:1.6rem;margin:0 0 8px}.b{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:10px;background:#d97757;color:#fff;font-weight:600}
.s{color:#777;font-size:.9rem;margin-top:18px}</style></head>
<body><div class="c"><div style="font-size:44px">🎁</div><h1>Sponsor credits page</h1>
<p>This is a placeholder standing in for the real promotion link. In production the attendee lands on the sponsor's redemption page here.</p>
<span class="b">Redeem $X credits</span><p class="s">Reached via a one-time, verified redirect.</p></div></body></html>`;

http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html))
  .listen(Number(process.env.PORT || 3999), () => console.log('sponsor demo page on :' + (process.env.PORT || 3999)));
