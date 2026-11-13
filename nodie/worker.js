// Nodie static build: runs the Python engine in Pyodide inside this worker.
// Module worker (Pyodide 314+ no longer supports classic workers).
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.8/full/pyodide.mjs';

const ready = (async () => {
  const py = await loadPyodide();
  await py.loadPackage('tzdata'); // IANA zones for zoneinfo (FIT UTC -> local time)
  const buf = await (await fetch(new URL('nodie_py.zip', self.location.href))).arrayBuffer();
  py.unpackArchive(buf, 'zip', { extractDir: '/home/pyodide/app' });
  py.runPython(`
import sys, os
os.environ.setdefault('NODEFINDER_WX_CACHE', '/tmp/nodefinder_weather.json')
sys.path.insert(0, '/home/pyodide/app')
import web_api
`);
  return py;
})();

self.onmessage = async (ev) => {
  const { id, op, fields, files } = ev.data;
  try {
    const py = await ready;
    const api = py.pyimport('web_api');
    let out;
    if (op === 'cartridges') {
      out = { ok: true, data: JSON.parse(api.cartridges_json()) };
    } else if (op === 'analyze') {
      const pyFiles = py.globals.get('dict')();
      for (const [name, f] of Object.entries(files || {})) {
        const t = py.toPy([f.name, new Uint8Array(f.bytes)]);
        // tuple(filename, bytes)
        const tup = py.runPython('lambda a: (a[0], bytes(a[1]))')(t);
        pyFiles.set(name, tup);
        t.destroy(); tup.destroy();
      }
      out = JSON.parse(api.analyze_json(JSON.stringify(fields), pyFiles));
      pyFiles.destroy();
    } else {
      out = { ok: false, data: { error: 'Unknown op ' + op } };
    }
    api.destroy();
    self.postMessage({ id, ...out });
  } catch (e) {
    self.postMessage({ id, ok: false, data: { error: String(e && e.message || e) } });
  }
};
