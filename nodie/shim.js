// Nodie static build: answers the app's /api/* calls from a Pyodide Web Worker
// instead of a Python server, so the page works on plain static hosting (any subpath).
(() => {
  const worker = new Worker(new URL('worker.js', document.currentScript.src), { type: 'module' });
  let seq = 0; const pending = new Map();
  worker.onmessage = (ev) => { const p = pending.get(ev.data.id); if (p) { pending.delete(ev.data.id); p(ev.data); } };
  const call = (msg, transfer) => new Promise(res => { const id = ++seq; pending.set(id, res); worker.postMessage({ id, ...msg }, transfer || []); });
  const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = new URL(url, location.href).pathname;
    if (path.endsWith('/api/cartridges')) {
      const r = await call({ op: 'cartridges' });
      return json(r.data, r.ok ? 200 : 400);
    }
    if (path.endsWith('/api/analyze')) {
      const fields = {}, files = {}, transfer = [];
      if (init.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) {
          if (v instanceof File) {
            if (v.name) { const bytes = await v.arrayBuffer(); files[k] = { name: v.name, bytes }; transfer.push(bytes); }
          } else fields[k] = v;
        }
      }
      const r = await call({ op: 'analyze', fields, files }, transfer);
      return json(r.data, r.ok ? 200 : 400);
    }
    return realFetch(input, init);
  };
  // Warm up Pyodide right away so the first analysis is fast.
  call({ op: 'cartridges' });
})();
