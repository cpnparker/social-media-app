/**
 * Refuses a production deploy that would silently revert someone else's work.
 *
 * WHY THIS EXISTS. `vercel deploy --prod` uploads the WORKING DIRECTORY to a
 * single production alias. Branch and alias are independent, and only one of
 * them is visible in the shell prompt. On 21 Aug 2026 a prompt-caching fix was
 * committed and deployed within thirteen seconds; eighteen minutes later a
 * deploy from a worktree on `main` — a branch that never contained it — put
 * production back to re-reading ~52,000 characters of system prompt uncached on
 * every turn. Nothing errored. Whoever deploys last wins and the loser's work
 * disappears with no error, which is why this has to be a gate rather than a
 * habit.
 *
 * THE RULE IT ENFORCES: deploy only from a clean tree at exactly `origin/main`.
 * Not "an ancestor of" and not "ahead of" — EXACTLY. Ahead means unpushed
 * commits that nobody else can see; behind means you are about to drop what is
 * already shipped. Making `origin/main` the single deploy source is what closes
 * the class, because it forces every session through one shared ref.
 *
 *   npx tsx scripts/verify-deploy-target.ts && npx vercel deploy --prod --yes
 */
import { execSync } from "child_process";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m: string) => console.log(`  ok    ${m}`);

function git(args: string): string {
  return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Allows the check itself to be exercised against a commit other than HEAD, so
// its failure modes can be proven rather than assumed.
const HEAD_REF = process.env.DEPLOY_CHECK_REF || "HEAD";

console.log("\nDeploy target check\n");

// 1. A dirty tree is the original sin: the deploy ships files, not commits, so
//    anything uncommitted here goes live — including another session's edits.
console.log("1. Working tree is clean");
let head = "";
try {
  const dirty = git("status --porcelain");
  if (dirty) {
    const lines = dirty.split("\n");
    fail(`${lines.length} uncommitted change(s) would ship to production:`);
    for (let i = 0; i < Math.min(lines.length, 10); i++) console.log(`        ${lines[i]}`);
    if (lines.length > 10) console.log(`        ...and ${lines.length - 10} more`);
  } else {
    pass("nothing uncommitted — the deploy will match the commit");
  }
  head = git(`rev-parse ${HEAD_REF}`);
} catch (err: any) {
  fail(`could not read git state: ${err?.message}`);
}

// 2. A stale origin/main makes check 3 meaningless — it would compare against
//    whatever this machine last happened to hear about.
console.log("\n2. origin/main is fresh");
let originMain = "";
try {
  if (!process.env.DEPLOY_CHECK_NO_FETCH) git("fetch origin main --quiet");
  originMain = git("rev-parse origin/main");
  pass(`origin/main is ${originMain.slice(0, 7)}`);
} catch (err: any) {
  fail(`could not fetch origin/main — cannot know what is already shipped: ${err?.message}`);
}

// 3. The check that would have caught the incident above.
console.log("\n3. HEAD is exactly origin/main");
if (head && originMain) {
  if (head === originMain) {
    pass(`at ${head.slice(0, 7)} — safe to deploy`);
  } else {
    const ahead = git(`rev-list --count origin/main..${HEAD_REF}`);
    const behind = git(`rev-list --count ${HEAD_REF}..origin/main`);
    if (Number(behind) > 0) {
      fail(`${behind} commit(s) on origin/main are NOT in your tree — deploying would REVERT them:`);
      const lost = git(`log --oneline ${HEAD_REF}..origin/main`).split("\n");
      for (let i = 0; i < Math.min(lost.length, 10); i++) console.log(`        ${lost[i]}`);
      console.log(`\n        Fix:  git pull --ff-only origin main`);
    }
    if (Number(ahead) > 0) {
      fail(`${ahead} commit(s) are only on this machine — push before shipping them:`);
      const unpushed = git(`log --oneline origin/main..${HEAD_REF}`).split("\n");
      for (let i = 0; i < Math.min(unpushed.length, 10); i++) console.log(`        ${unpushed[i]}`);
      console.log(`\n        Fix:  git push origin HEAD:main`);
    }
  }
}

// 4. Not a gate — the situational awareness the shell prompt does not give you.
//    A branch holding work nobody has merged is exactly where the reverted fix
//    was sitting when it got overwritten.
console.log("\n4. Other local branches (informational)");
try {
  const branches = git("for-each-ref --format='%(refname:short)' refs/heads").split("\n");
  let noted = 0;
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    if (!b || b === "main") continue;
    const n = Number(git(`rev-list --count origin/main..${b}`));
    if (n > 0) { console.log(`  note  ${b} has ${n} commit(s) not on origin/main`); noted++; }
  }
  if (!noted) pass("no local branch is holding unmerged work");
} catch (err: any) {
  // Says WHY rather than swallowing. A bare `catch {}` here hid an unquoted
  // shell format string — the section printed nothing at all and read as
  // "no other branches", which is the most dangerous thing it could have said.
  console.log(`  note  could not inspect local branches: ${err?.message?.split("\n")[0]}`);
}

console.log(failures ? `\n${failures} FAILURE(S) — DO NOT DEPLOY\n` : `\nAll checks passed.\n`);
process.exit(failures ? 1 : 0);
