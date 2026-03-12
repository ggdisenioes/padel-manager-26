import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const secretPatterns = [
  { name: "supabase_pat", regex: /\bsbp_[a-f0-9]{32,}\b/gi },
  { name: "github_pat", regex: /\bghp_[A-Za-z0-9]{20,}\b/gi },
  { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google_api_key", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "jwt_like_token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "resend_api_key", regex: /\bre_[A-Za-z0-9]{20,}\b/g },
  { name: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
];

const ignoredPathFragments = [
  "node_modules/",
  ".next/",
  ".vercel/",
  "playwright-report/",
  "test-results/",
  "PRE.PADELX/",
  "demo.padelx/",
];

const ignoredExactFiles = new Set([
  ".env.example",
  "package-lock.json",
]);

const safeHintPattern =
  /(example|sample|placeholder|dummy|test|mock|your_|changeme|xxxx|<token>|<key>|token_here|api_key_here)/i;

function getTrackedFiles() {
  const output = execSync("git ls-files", { encoding: "utf8" });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldSkipFile(file) {
  if (ignoredExactFiles.has(file)) return true;
  return ignoredPathFragments.some((fragment) => file.includes(fragment));
}

function inspectFile(file, findings) {
  const absPath = path.join(root, file);
  let content = "";

  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || safeHintPattern.test(trimmed)) continue;

    for (const pattern of secretPatterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      const matches = trimmed.match(regex);
      if (!matches || matches.length === 0) continue;

      findings.push({
        file,
        line: i + 1,
        pattern: pattern.name,
        excerpt: trimmed.slice(0, 160),
      });
    }
  }
}

const trackedFiles = getTrackedFiles();
const findings = [];

for (const file of trackedFiles) {
  if (shouldSkipFile(file)) continue;
  inspectFile(file, findings);
}

if (findings.length > 0) {
  console.error("Potential secret leaks detected in tracked files:");
  for (const item of findings) {
    console.error(
      `- ${item.file}:${item.line} [${item.pattern}] ${item.excerpt}`
    );
  }
  process.exit(1);
}

console.log("OK: no high-risk secret patterns found in tracked files.");
