---
name: hale-more
description: Speed up work on Hale — take more tasks from the queue beyond the daily amount. The argument is how many tasks (default 2).
---

The owner wants to move faster than the daily run.

Read `.claude/skills/hale-day/SKILL.md` and carry it out with these differences:

- the number of tasks is the command's argument: $ARGUMENTS (if empty — 2);
- tasks that are already «в работе» or were done today do not count; take the next ready ones;
- do not start a new summary: add a section «Дополнительно, ЧЧ:ММ» to today's file (if there is no file for today, create it);
- the ceilings are the same: a task waiting for the owner is not taken; server accounting tasks go one at a time; no more than two builders in parallel.

If there are fewer ready tasks than asked for, do as many as there are and say in the first line of your answer, in Russian, what exactly is holding the rest: usually it is the owner's decisions from the «ждёт владельца» list. List them so the owner can answer right away.
