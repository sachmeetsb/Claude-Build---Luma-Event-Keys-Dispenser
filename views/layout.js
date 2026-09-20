export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EVENT_NAME = process.env.EVENT_NAME || 'Claude Code Build Day';

export function layout(title, body, { wide = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · ${esc(EVENT_NAME)}</title>
<style>
  :root{--bg:#0f0e0c;--card:#1a1815;--ink:#f2ede4;--muted:#a39c90;--accent:#d97757;--ok:#4caf7d;--err:#e06c5c;--line:#2a2724}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
  main{width:100%;max-width:${wide ? '960px' : '440px'}}
  h1{font-size:1.5rem;margin:0 0 4px}
  .sub{color:var(--muted);margin:0 0 20px;font-size:.95rem}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:16px}
  label{display:block;font-size:.9rem;color:var(--muted);margin:14px 0 6px}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:#0f0e0c;color:var(--ink);font-size:1rem}
  input:focus{outline:2px solid var(--accent);border-color:transparent}
  button,.btn{display:inline-block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:1.05rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
  button.secondary{background:transparent;border:1px solid var(--line);color:var(--ink)}
  .msg{padding:12px 14px;border-radius:10px;margin-bottom:14px;font-size:.95rem}
  .msg.err{background:rgba(224,108,92,.12);border:1px solid rgba(224,108,92,.4)}
  .msg.ok{background:rgba(76,175,125,.12);border:1px solid rgba(76,175,125,.4)}
  .msg.info{background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--muted)}
  .qr{display:block;width:100%;max-width:320px;margin:12px auto;border-radius:12px;background:#fff;padding:12px}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:.95rem}
  .kv b{color:var(--muted);font-weight:500}
  code{background:#0f0e0c;padding:2px 6px;border-radius:6px;font-size:.92em}
  .small{font-size:.85rem;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:.9rem}
  th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{color:var(--muted);font-weight:500}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .row form{flex:1}
  .row button{margin-top:0}
  footer{margin-top:auto;padding-top:24px;color:var(--muted);font-size:.8rem}
</style>
</head>
<body>
<main>${body}</main>
<footer>${esc(EVENT_NAME)}</footer>
</body>
</html>`;
}
