import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';

// Compile the actual server/domain modules into an ignored test directory. This
// keeps the tests dependency-free and exercises the same route used by the UI.
const output = resolve('.cache/tests');
const modules = [
  ['lib/examples.ts', 'lib/examples.mjs'],
  ['lib/showcase.ts', 'lib/showcase.mjs'],
  ['lib/genomics-demo.ts', 'lib/genomics-demo.mjs'],
  ['tests/examples.test.ts', 'tests/examples.test.mjs'],
  ['lib/research.ts', 'lib/research.mjs'],
  ['lib/demo-provider.ts', 'lib/demo-provider.mjs'],
  ['lib/workflow-provenance.ts', 'lib/workflow-provenance.mjs'],
  ['lib/sciencepal-client.ts', 'lib/sciencepal-client.mjs'],
  ['app/api/workflow/route.ts', 'app/api/workflow/route.mjs'],
  ['server/lib/sciencepal.ts', 'server/lib/sciencepal.mjs'],
  ['app/api/sciencepal/route.ts', 'app/api/sciencepal/route.mjs'],
  ['tests/sciencepal.test.ts', 'tests/sciencepal.test.mjs'],
  ['tests/sciencepal-client.test.ts', 'tests/sciencepal-client.test.mjs'],
  ['tests/workflow.test.ts', 'tests/workflow.test.mjs'],
];
for (const [source, destination] of modules) {
  const filename = resolve(output, destination);
  await mkdir(resolve(filename, '..'), { recursive: true });
  const code = ts.transpileModule(await readFile(source, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: source }).outputText
    .replaceAll("'@/lib/research'", "'../../../lib/research.mjs'")
    .replaceAll("'@/lib/demo-provider'", "'../../../lib/demo-provider.mjs'")
    .replaceAll("'@/lib/workflow-provenance'", "'../../../lib/workflow-provenance.mjs'")
    .replaceAll("'@/server/lib/sciencepal'", "'../../../server/lib/sciencepal.mjs'")
    .replaceAll("'./genomics-demo'", "'./genomics-demo.mjs'")
    .replaceAll("'./demo-provider'", "'./demo-provider.mjs'")
    .replaceAll("'../lib/examples'", "'../lib/examples.mjs'")
    .replaceAll("'../lib/showcase'", "'../lib/showcase.mjs'")
    .replaceAll("'./research'", "'./research.mjs'")
    .replaceAll("'./workflow-provenance'", "'./workflow-provenance.mjs'")
    .replaceAll("'../../lib/research'", "'../../lib/research.mjs'")
    .replaceAll("'../server/lib/sciencepal'", "'../server/lib/sciencepal.mjs'")
    .replaceAll("'../lib/research'", "'../lib/research.mjs'")
    .replaceAll("'../lib/demo-provider'", "'../lib/demo-provider.mjs'")
    .replaceAll("'../lib/workflow-provenance'", "'../lib/workflow-provenance.mjs'")
    .replaceAll("'../lib/sciencepal-client'", "'../lib/sciencepal-client.mjs'")
    .replaceAll("'../app/api/workflow/route'", "'../app/api/workflow/route.mjs'")
    .replaceAll("'../app/api/sciencepal/route'", "'../app/api/sciencepal/route.mjs'");
  await writeFile(filename, code);
}
const result = spawnSync(process.execPath, ['--test', resolve(output, 'tests/examples.test.mjs'), resolve(output, 'tests/workflow.test.mjs'), resolve(output, 'tests/sciencepal.test.mjs'), resolve(output, 'tests/sciencepal-client.test.mjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
