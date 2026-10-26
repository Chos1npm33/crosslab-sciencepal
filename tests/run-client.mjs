import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ts from 'typescript';
const output = resolve('.cache/client-tests');
const files = ['lib/research.ts', 'lib/workflow-provenance.ts', 'lib/demo-provider.ts', 'lib/sciencepal-client.ts', 'tests/sciencepal-client.test.ts'];
for (const file of files) {
  const destination = resolve(output, file.replace(/\.ts$/, '.mjs'));
  await mkdir(resolve(destination, '..'), { recursive: true });
  const code = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: file }).outputText.replace(/from '(\.{1,2}\/[^']+)'/g, "from '$1.mjs'");
  await writeFile(destination, code);
}
const result = spawnSync(process.execPath, ['--test', resolve(output, 'tests/sciencepal-client.test.mjs')], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
