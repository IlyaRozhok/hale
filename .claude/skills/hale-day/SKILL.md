---
name: hale-day
description: Daily run of work on Hale. The lead agent takes tasks from the queue, hands them to builders, takes them through CI and independent review, merges, checks the screens and writes the owner a summary with the decisions waiting for them.
---

You are the lead agent of the day in the Hale project. The owner does not follow every step: they read the summary and answer the decisions. Your job is to get as many queue tasks into `main` as honestly works out, and to break nothing.

Argument (optional): how many tasks to take. Default 3.

Language: talk to the owner and write `backlog.md`, `status.md`, the daily summary, PR titles and descriptions and commit messages in Russian. Briefs to builders and reviewers, and their reports, are in English; quote the task text from the queue as it is, in Russian.

## 0. Start

1. Read `CLAUDE.md`, `docs/superpowers/pitfalls.md`, `docs/superpowers/backlog.md`, the latest file in `docs/superpowers/daily/` and the section «Следующая работа» in `docs/superpowers/status.md`.
2. `git checkout main && git pull`. The working copy must be clean; do not touch or revert someone else's uncommitted changes — write about them in the summary and stop.
3. `gh run list --branch main --limit 1`: if CI on `main` is red, the first task of the day is to fix it.
4. If the owner has answered decisions from the previous summary (in this session or in the summary), record the answers in `backlog.md` and remove «ждёт владельца».

## 1. Choosing tasks

Take tasks top to bottom with the status «готова» whose «после …» condition is met, until you have the number you need. Rules:
- two tasks must not touch the same files; tasks marked «Сервер» — no more than one at a time in a run;
- no more than two builders in parallel (the tests and the type check are heavy);
- a task marked «Макет: да» is not built: a mockup is prepared for it (up to three a day) and it stays «ждёт владельца». A mockup is two or three variants as a picture in `docs/superpowers/daily/YYYY-MM-DD/`, with a recommendation; write the question and the path to the picture into the task;
- if there are no ready tasks, do not invent work: the summary says that everything is waiting for the owner.

Mark the chosen ones «в работе».

## 2. Building

For each task start a `hale-builder` agent with `isolation: "worktree"`. Put into the brief the full task text from the queue, the owner's decisions from the audit that relate to it, and what is already known about the code. Start independent tasks in one message.

A builder returns a PR link or a question. A question you can answer from the documents — answer it and continue; a question for the owner — the task gets «ждёт владельца».

## 3. Review and merge, one PR at a time

1. Wait for CI with one background command: `gh pr checks <N> --watch --fail-fast`. Red CI — return it to the builder with the output of the failed step. The reviewer from step 2 works at the same time.
2. Start a `hale-reviewer` agent with `isolation: "worktree"` (otherwise it would switch the branch in the shared copy), with the PR number, the task text and any permissions you gave the builder beyond the task. It must not see your conclusions about the PR. You can start it right away without waiting for CI to finish: both conditions meet in step 4.
3. `CHANGES REQUESTED` — pass the findings to the builder verbatim. No more than two rounds; after the second the task is «застряла» with the reason, and the PR stays open.
4. `APPROVED` and green CI — `gh pr merge <N> --squash --delete-branch`, then `git pull`. While the branch is held by the builder's working copy, the command merges the PR but does not delete the branch on GitHub: follow it with `git push origin --delete <branch>`. On a conflict the builder rebases the next PR onto fresh `main`, and CI runs again. After the last merge make sure CI on `main` is green: each PR was checked on its own base, not together with the others. If it is red, fix it before anything else and say so in the summary.

No PR is merged without both conditions. If in doubt about money, do not merge; take it to the owner.

## 4. Screens

If the look or behaviour of a screen changed during the run: bring up the stand by `scripts/sim/README.md`, walk through the changed places, take screenshots and send them to the owner. The stand's Metro shows the shared copy, so merged work is visible after `git pull`; take the "before" screenshots before it. Anything on the screen that does not match the task is not "done": return it to the builder or open a task. Stop the stand at the end.

## 5. Records

One branch `docs/day-YYYY-MM-DD` and one PR (through CI and review as well), all three files in Russian:
- `backlog.md`: statuses, dates, PR numbers, newly found tasks — at the end of their stage or in «Запас идей»;
- `status.md`: what changed in the product, briefly, in the style of the file; a new build, test or environment pitfall goes into `docs/superpowers/pitfalls.md`, in English;
- `docs/superpowers/daily/YYYY-MM-DD.md` — the summary; the day's screenshots and mockups go into the directory `daily/YYYY-MM-DD/`.

Create the branch as a separate working copy (`git worktree add`), not by switching the branch in the shared copy. At the end remove this run's builder and reviewer working copies and their local branches — only if a copy has nothing uncommitted and its branch is merged or pushed; otherwise leave it and say so in the summary. Do not touch other sessions' copies.

## 6. Summary

The daily file, and the same thing as a message to the owner, in Russian, with these sections:

1. **Сделано** — the task, one line on what changed for a person, the PR number.
2. **Решения для вас** — numbered, each with options and your recommendation; mockups attached. If there are no decisions, say so.
3. **Не получилось** — what got stuck and why, without softening.
4. **Деплой** — whether one is needed (did `apps/api`, `packages/contracts` or `infra` change), whether there is a migration, the command: `DEPLOY_HOST=2.31.201.103 DOMAIN=api.halemoney.com infra/deploy.sh` (if SSH does not answer, `infra/open-ssh.sh` first). Whether a new iPhone build is needed.
5. **Дальше** — what will be taken next time.

At the end one notification (`PushNotification`): how many are done and how many decisions are waiting.

## What not to do

- Do not deploy, touch the server or real data, or build to the phone without the owner's consent in this session.
- Do not start a stage while the previous one still has ready tasks, unless the owner said otherwise.
- Do not write "done" about something that was not verified: write exactly what was not verified.
