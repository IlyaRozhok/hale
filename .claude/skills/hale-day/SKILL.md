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
- two tasks that touch the same files never run in parallel: they go one after another within the run, the second started from `main` after the first is merged; if the first is not merged (stuck or waiting for the owner), the second is not started in this run. Tasks marked «Сервер» — no more than one at a time in a run;
- no more than two builders in parallel (the tests and the type check are heavy);
- a task marked «Макет: да» is not built: a mockup is prepared for it (up to three a day) and it stays «ждёт владельца». A mockup is two or three variants as a picture in `docs/superpowers/daily/YYYY-MM-DD/`, with a recommendation; write the question and the path to the picture into the task;
- if there are no ready tasks, do not invent work: the summary says that everything is waiting for the owner.

Do not write «в работе» into the queue: an open PR whose title carries the task ID is that mark, and only results go into the file. This relies on one run working at a time: the owner does not start `/hale-day` and `/hale-more` together, and you cannot detect a second run yourself. So an open task PR you find at the start (`gh pr list`) is a leftover of an earlier run: do not take its task, and name the PR in the summary under «Не получилось».

## 2. Building

Before handing a task out, spend a minute searching the code and the tests for what it really touches — including tests in other files that assert the behaviour the task changes — and correct the «Где» list in the brief. Tasks are chosen for parallel work by that list, so it has to be true: once the lists are corrected, apply the overlap rule from section 1 again, and move a task that now shares a file with another to go after it. The builder stays inside the corrected list and stops with a question if it turns out wrong.

For each task start a `hale-builder` agent with `isolation: "worktree"`. Put into the brief the full task text from the queue with the corrected «Где», the owner's decisions from the audit that relate to it, and what is already known about the code. Start independent tasks in one message.

A builder returns a PR link or a question. A question you can answer from the documents — answer it and continue; a question for the owner — the task gets «ждёт владельца».

## 3. Review and merge, one PR at a time

1. Wait for CI with one background command: `gh pr checks <N> --watch --fail-fast`. Red CI — return it to the builder with the output of the failed step. The reviewer from step 2 works at the same time.
2. Start a `hale-reviewer` agent with `isolation: "worktree"` (otherwise it would switch the branch in the shared copy), with the PR number, the task text as you gave it to the builder — with the corrected «Где» — and any permissions you gave the builder beyond it. It must not see your conclusions about the PR. You can start it right away without waiting for CI to finish: both conditions meet in step 5.
3. When the reviewer returns, whatever the verdict and in every round, you record it in the PR before doing anything else: write the report verbatim to a file under the heading «Вердикт независимого проверяющего» with the commit the reviewer names in its report (if it names none, the PR head at the moment you started it: note `gh pr view <N> --json headRefOid` then, not when posting), and post it with `gh pr comment <N> --body-file <file>`; keep the file in your scratch directory, not in the repository (a report passed in `--body` has its backticks run by the shell). The reviewer itself never writes to the PR. This is what lets the merge rule be checked on GitHub and not only in this session.
4. `CHANGES REQUESTED` — pass the findings to the builder verbatim. No more than two rounds; after the second the task is «застряла» with the reason, and the PR stays open with both verdicts in it.
5. `APPROVED` and green CI on the commit the reviewer saw — `gh pr merge <N> --squash --delete-branch`, then `git pull`. If the PR head moved after the review (a fix for red CI, a rebase onto fresh `main`), the approval no longer covers it: send the new head to the reviewer again before merging; that round does not count towards the two. While the branch is held by the builder's working copy, the command merges the PR but does not delete the branch on GitHub: follow it with `git push origin --delete <branch>`. On a conflict the builder rebases the next PR onto fresh `main`, and CI runs again. After the last merge make sure CI on `main` is green: each PR was checked on its own base, not together with the others. If it is red, fix it before anything else and say so in the summary.

No PR is merged without both conditions. If in doubt about money, do not merge; take it to the owner.

## 4. Screens

If the look or behaviour of a screen changed during the run: bring up the stand by `scripts/sim/README.md`, walk through the changed places and take screenshots. The stand's Metro shows the shared copy, so merged work is visible after `git pull`; take the "before" screenshots before it. Anything on the screen that does not match the task is not "done": return it to the builder or open a task.

Save screenshots outside the repository, in your session's scratch directory — not in `.sim/`, which `down.sh` and `up.sh` wipe — and send them to the owner as soon as the check is finished; the summary then only names what was sent.

Then stop what you started, before the session ends: the stand always, and Metro if you started it (the last step of the README). A Metro you used but did not start is not yours to stop: leave it running and name it in the summary under «Не получилось», with its port and working directory. Finish by checking ports 8082, 3100 and 55432: nothing you started may still be listening; a listener that is not yours is reported the same way, not killed.

## 5. Records

One branch `docs/day-YYYY-MM-DD` and one PR (through CI and review as well), all three files in Russian:
- `backlog.md`: statuses, dates, PR numbers, newly found tasks — at the end of their stage or in «Запас идей»;
- `status.md`: what changed in the product, briefly, in the style of the file; a new build, test or environment pitfall goes into `docs/superpowers/pitfalls.md`, in English;
- `docs/superpowers/daily/YYYY-MM-DD.md` — the summary. Mockups that wait for the owner's decision go into the directory `daily/YYYY-MM-DD/`. Screenshots are not committed: they were sent to the owner in section 4. A mockup stays in the directory after the decision, until its task is built: the builder needs it.

Create the branch as a separate working copy (`git worktree add`), not by switching the branch in the shared copy. At the end remove this run's builder and reviewer working copies and their local branches — only if a copy has nothing uncommitted and its branch is merged or pushed; otherwise leave it and say so in the summary. Do not touch other sessions' copies.

## 6. Summary

The daily file, and the same thing as a message to the owner, in Russian, with these sections:

1. **Сделано** — the task, one line on what changed for a person, the PR link.
2. **Решения для вас** — numbered, each with options and your recommendation; mockups attached. If there are no decisions, say so.
3. **Не получилось** — what got stuck and why, without softening.
4. **Деплой** — whether one is needed (did `apps/api`, `packages/contracts` or `infra` change), whether there is a migration, the command: `DEPLOY_HOST=2.31.201.103 DOMAIN=api.halemoney.com infra/deploy.sh` (if SSH does not answer, `infra/open-ssh.sh` first). Whether a new iPhone build is needed.
5. **Дальше** — what will be taken next time.

At the end one notification (`PushNotification`): how many are done and how many decisions are waiting.

## What not to do

- Do not deploy, touch the server or real data, or build to the phone without the owner's consent in this session.
- Do not start a stage while the previous one still has ready tasks, unless the owner said otherwise.
- Do not write "done" about something that was not verified: write exactly what was not verified.
