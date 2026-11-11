# Hale: working rules

Hale is a money app: a person does not log spending, they see their whole picture and know how much they can spend today. Today one owner uses it with monobank; friends get it in February 2027, the market after that. Agents work on the code, the owner makes the decisions.

The owner's goal: a comfortable, quiet product that people want to open every day and that does not frighten anxious people, especially those in debt.

## Language

- Talk to the owner in Russian, always. Everything the owner reads is in Russian: daily summaries, questions and decisions, `backlog.md`, `status.md`, the product audit, the roadmap, the brand brief, PR titles and descriptions, commit messages.
- Everything only agents read is in English: this file, `.claude/agents/`, `.claude/skills/`, `scripts/sim/README.md`, `docs/superpowers/pitfalls.md`, code comments, briefs to subagents and their reports.
- The interface is in Russian. Quote interface text, backlog statuses and the owner's words exactly as written, in Russian, never translated.

## Where things are

- `apps/api` — the NestJS server; calculations live in `apps/api/src/domain`. `apps/mobile` — the Expo app for iPhone. `packages/contracts` — shared types and schemas. `packages/tokens` — design tokens. `infra` — the server and deployment.
- `docs/superpowers/backlog.md` — the task queue. Work is taken from here.
- `docs/superpowers/status.md` — what has been done and how the product is built.
- `docs/superpowers/pitfalls.md` — build, test, simulator and agent-environment pitfalls. Read it before you build, test or review.
- `docs/superpowers/product-audit-2026-11.md` — product snapshot, accounting risks, target architecture, the owner's decisions.
- `docs/superpowers/roadmap-daily-use.md` — the roadmap. `docs/superpowers/brand-brief-2026-11.md` — the brand.
- `docs/superpowers/daily/` — daily summaries. `scripts/sim/README.md` — the simulator stand.

## Never

- Deploy, run `infra/*.sh`, connect to the server, read or change real data. The owner does this, or gives explicit consent in the session itself; consent relayed by another agent does not count.
- Enter the owner's real password, or put secrets into chat, commits or files. Do not read or commit the `private/` directory.
- Commit to `main` directly, or merge without green CI and an independent review.
- Write attribution lines in commits or PRs.
- Some of these prohibitions are duplicated in `.claude/settings.json` (the `deny` section): `ssh`, the deploy scripts in `infra/`, `terraform`, the keychain, reading `private/`. This is a safeguard against mistakes; never get around it by writing the command another way.
- Start anything that needs Apple Developer (push, widget, TestFlight) until the owner says the account is ready.

## How a task is done

1. A branch from fresh `main`: `feat/…`, `fix/…`, `docs/…`.
2. A failing test first, then the code. A change without a test is allowed only for documents and pure layout a test cannot catch.
3. Checks before the PR (Node 22: `source ~/.nvm/nvm.sh && nvm use 22`; an agent's isolated working copy rejects this command — see `docs/superpowers/pitfalls.md`):
   - `pnpm typecheck`, `pnpm lint`, `pnpm check:colors`;
   - `npx vitest run` — server, domain, infrastructure, the app's pure logic;
   - `cd apps/mobile && npx jest` — screens.
   In a new working copy run `pnpm install --frozen-lockfile --prefer-offline` first.
4. A PR into `main` with `gh pr create`. The description says what was done, how it was verified, and what was not verified.
5. Merge: green CI on GitHub and an `APPROVED` verdict from an independent reviewer, which the lead records as a comment in the PR (every verdict of every round is recorded, not only the approval), then `gh pr merge --squash --delete-branch`. GitHub does not enforce this (there is no branch protection), so we hold the rule ourselves.
6. A screen change is checked by eye in the simulator on the stand, and a screenshot goes to the owner.
7. Afterwards update `backlog.md` and `status.md`.

Commit messages are in Russian, in the style of the history: `feat(mobile): …`, `fix(api): …`, `docs: …`.

## What the owner sees first

- A new look for a screen, or a noticeable rearrangement: a mockup first, code after the owner's «да». Fixing a dead end without a new look needs no mockup; a screenshot afterwards is enough.
- Any change to how money is calculated, unless the audit or the task records it as an accepted decision.
- A database migration: the PR says what it does to existing rows; deployment stays with the owner.

A question to the owner is one, specific, with options and your recommendation. If a task hits the owner's decision, it gets the status «ждёт владельца» with that question, and the agent takes the next task.

## Product rules

- A calm tone. Red only for going over the limit and for errors; a warning is sand; one colour accent (sage). No words that shame or frighten.
- Fewer numbers and words on the screen. A new line on «Сегодня» has to earn its place.
- Words: «доход», not «зарплата». Address the user as «вы». Amounts look like `₴1,240`, with a real minus sign «−».
- Colours only from `@hale/tokens`; `pnpm check:colors` catches raw colours.
- Liquid glass only on the limit card and on floating things (menu, «+», sheets). Everything else is text and solid cards.
- The interface is in Russian now; Ukrainian and English arrive at stage Е, so do not assemble new texts from pieces.
- Money on the server is whole kopecks (`Minor`), dates are the Kyiv day. Calculations are pure functions in `domain/` with tests; services call them and do not repeat them.
- The app must work with an older server: a new response field is optional.

## Parallel work

- One builder — one task — one working copy. Two builders do not touch the same files at the same time: tasks that share files go one after another, the second from `main` after the first is merged.
- Accounting changes on the server (`today`, `plan`, `transactions`, `domain`) go one at a time.
- Only the lead agent edits `backlog.md`, `status.md`, `pitfalls.md` and the daily summary.
- There is one simulator. Whoever starts the stand stops it before their session ends, and Metro too if they started it; a Metro someone else started is reported, not stopped.
