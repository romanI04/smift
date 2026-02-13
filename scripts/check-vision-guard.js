#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();

function readFile(relPath) {
  const filePath = path.join(projectRoot, relPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${relPath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

function assertContains(relPath, requiredSnippets) {
  const content = readFile(relPath);
  const missing = requiredSnippets.filter((snippet) => !content.includes(snippet));
  if (missing.length > 0) {
    throw new Error(
      `Vision guard failed for ${relPath}. Missing required snippet(s): ${missing
        .map((m) => `"${m}"`)
        .join(', ')}`,
    );
  }
}

function walkFiles(relDir) {
  const dirPath = path.join(projectRoot, relDir);
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dirPath, {withFileTypes: true})) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(path.relative(projectRoot, full)));
      continue;
    }
    out.push(path.relative(projectRoot, full));
  }
  return out;
}

function checkForbiddenSourceTerms() {
  const forbidden = [
    /\bavatar\b/i,
    /\banthropomorphic\b/i,
    /\bvirtual host\b/i,
    /\blip[\s-]?sync\b/i,
  ];

  const sourceFiles = walkFiles('src').filter((p) => /\.(ts|tsx|js|jsx)$/.test(p));
  const violations = [];

  for (const relPath of sourceFiles) {
    const content = readFile(relPath);
    for (const rule of forbidden) {
      if (rule.test(content)) {
        violations.push(`${relPath} matched ${rule}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Vision guard failed: avatar-focused source terms found.\n${violations.join('\n')}`,
    );
  }
}

function main() {
  assertContains('docs/VISION.md', [
    'artifact-first',
    'avatar-less',
    'Non-Goals',
    'Scope Lock Checklist',
  ]);
  assertContains('docs/ROADMAP.md', [
    'Vision Lock (Do Not Drift)',
    'artifact-first',
    'avatar-less',
  ]);
  assertContains('README.md', [
    'Artifact-first, premium output.',
    'Avatar-less by strategy',
    'npm run check:vision',
  ]);
  checkForbiddenSourceTerms();
  console.log('Vision guard passed.');
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
