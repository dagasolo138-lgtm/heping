import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? '.artifacts/day60';

async function collectJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
  }
  return files;
}

const files = await collectJsonFiles(root);
assert.equal(files.length, 3, `Expected 3 day-60 audit reports, found ${files.length}`);

const reports = [];
for (const file of files) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(report.status, 'pass', `${file} did not pass`);
  assert.equal(report.targetDay, 60, `${file} is not a day-60 report`);
  assert.ok(report.finalStateDigest, `${file} is missing finalStateDigest`);
  reports.push({ file, batchSize: report.batchSize, digest: report.finalStateDigest });
}

reports.sort((first, second) => first.batchSize - second.batchSize);
assert.deepEqual(reports.map((entry) => entry.batchSize), [1, 5, 10]);
assert.equal(
  new Set(reports.map((entry) => entry.digest)).size,
  1,
  `Batch-size divergence detected: ${JSON.stringify(reports)}`,
);

console.log(`STABILITY_BATCH_DIGEST=${reports[0].digest}`);
console.log(`STABILITY_BATCHES=${reports.map((entry) => entry.batchSize).join(',')}`);
