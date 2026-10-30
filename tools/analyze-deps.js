// Compute transitive local-require closure and external npm modules for entry scripts.
const fs = require('fs');
const path = require('path');
const builtins = new Set(require('module').builtinModules);

function resolveLocal(fromFile, spec) {
  let base;
  if (spec.startsWith('./') || spec.startsWith('../')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('/')) base = spec;
  else return null; // bare specifier = external
  for (const cand of [base, base + '.js', base + '.json', path.join(base, 'index.js')]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch {}
  }
  return null;
}

function walk(entry) {
  const seen = new Set();
  const external = new Map(); // name -> Set(files)
  const missing = new Map();
  const queue = [path.resolve(entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (builtins.has(spec) || spec.startsWith('node:')) continue;
      const local = resolveLocal(file, spec);
      if (local) { queue.push(local); continue; }
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        if (!missing.has(spec)) missing.set(spec, new Set());
        missing.get(spec).add(path.relative(process.cwd(), file));
        continue;
      }
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!external.has(name)) external.set(name, new Set());
      external.get(name).add(path.relative(process.cwd(), file));
    }
  }
  return { files: [...seen].map(f => path.relative(process.cwd(), f)), external, missing };
}

const entries = process.argv.slice(2);
if (!entries.length) {
  console.error('usage: node analyze_deps.js <entry.js> [...]');
  process.exit(1);
}
for (const e of entries) {
  const r = walk(e);
  console.log(`\n=== ${e}  (${r.files.length} local files) ===`);
  console.log('external:', [...r.external.keys()].sort().join(', ') || '(none)');
  for (const [name, files] of [...r.external.entries()].sort()) {
    console.log(`   ${name}  <- ${[...files].slice(0, 4).join(', ')}`);
  }
  if (r.missing.size) {
    console.log('UNRESOLVED local requires:');
    for (const [s, f] of r.missing) console.log(`   ${s}  <- ${[...f].slice(0, 3).join(', ')}`);
  }
}
