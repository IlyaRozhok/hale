# Pitfalls: build, tests, simulator, agent environment

For agents, in English. Each item cost someone time once. When you hit a new one, put it in your report; the lead adds it here.

## Agent environment

- **Node 22 in an isolated working copy.** The environment rejects `source ~/.nvm/nvm.sh && nvm use 22`. Put the path in front of the command instead: `PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | grep '^v22' | sort -V | tail -1)/bin:$PATH" pnpm …`. In a chain like `cd apps/mobile && npx jest` the path goes after the `&&`, in front of `npx`.
- **Git in an isolated working copy** is accepted only as a separate simple command: no `cd`, `&&` or `PATH` override on the same line.
- **`gh pr checkout N` fails** while the PR's branch is held by the builder's working copy. A reviewer uses `gh pr view N --json headRefOid`, `git fetch origin pull/N/head`, `git checkout --detach <sha>`.
- **`gh pr merge --delete-branch`**, for the same reason, merges the PR but stops at deleting the local branch and does not delete the branch on GitHub. After the merge: `git push origin --delete <branch>`.
- **Compound commands in an isolated working copy.** A Bash command that mixes a long heredoc (for example `python3 - <<EOF` editing files) with `cd … && PATH=… npx jest`, or with `git`, is refused as "too complex to verify that it stays inside the worktree". Split it: put the script in a file in the scratch directory and run it as its own command. On 12 November 2026 two builders also reported a refusal with the same message for a heredoc with no `git` or `npx` on the line; a reviewer the same day could not reproduce it (a plain `cat > file <<'EOF'` into the scratch directory was accepted), so the exact condition is not known. Later the same day another reviewer had `cat > file <<'EOF'` with TypeScript content refused three times, into the worktree and into the scratch directory alike, while `printf '%s\n' '…' > file` was accepted. If it is refused, create the file with the Write tool, or with `printf` when the agent has no Write tool. A builder later that day had `python3 - <<'EOF'` followed by `PATH=… npx jest` in one command accepted, and `git -C .` refused: treat the refusal as intermittent, not as a fixed rule.
- **The simulator tool does not work in a scheduled run.** `mcp__Claude_Code_iOS_Simulator__control` answers "Mobile simulator tools require an attended session" when the session was started by the schedule. The stand and Metro still start, but nothing can be tapped. The owner writing in that session later does not change it: the tool still refuses, so screens can only be checked in a session the owner started. Do not drive the Simulator window another way: skip the screen check, stop the stand, and say in the summary which screens nobody saw (12 November 2026).
- **The full type check** (`pnpm typecheck`) takes about 6 GB of memory. No more than two builders at once; reviewers do not run it.

## Tests

- **Tests with sheets.** A sheet closes with a 200 ms animation and only then disappears. In tests the list under the sheet can be pressed while it is closing (on the phone the scrim blocks that), and the same sheet reopened for another row lives out the old animation and closes. So after «Закрыть» first wait until the sheet is gone (`waitFor(... toBeNull())`), and only then press on. Without this a test passes on a fast machine and fails in CI (11 November 2026: two tests, fixed).

- **`Login.test.tsx` on a cold run.** Right after `pnpm install`, the first full `npx jest` can time out (5000 ms) in "signs in with the password and device name"; alone or on a second run it passes. Seen once by a reviewer on 12 November 2026, not in CI.

## iOS build

- Run `pod install` only with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`, otherwise it fails.
- `pod install` over an existing `ios/Pods` wipes the version stamps of React, Hermes and the dependencies but leaves the files from the last build. The build then fails at linking or at launch. Cure: delete `ios/Pods` and install again.
- A rebuild does not always move the 7-day signature. Xcode may reuse the existing Personal Team provisioning profile while it is valid (seen on 12 November 2026; the build of 11 November got a fresh one), and then the app expires on the old date. Read the real date after a build: `strings <DerivedData>/Build/Products/Release-iphoneos/Hale.app/embedded.mobileprovision | grep -A1 ExpirationDate` (the `security` command is denied to agents).
- `expo run:ios` ends by opening the app on port 8081. If another Metro is running there, the app looks at the real server: for a local check close it at once and open your own port.

## Simulator and stand

- **Stopping Metro.** `pkill -f "expo start"` does not find the stand's Metro (the process is named differently). Use `lsof -ti tcp:8082 -sTCP:LISTEN | xargs kill`.
- **Taps arrive late sometimes.** After a tap wait 2 s and only then take a screenshot, otherwise the next tap opens the wrong sheet and the screenshot shows the screen from before the tap. The floating developer-menu button sits on top of «Закрыть» in sheets.
- **The simulator tool types in the current layout, and it is Russian:** Latin letters arrive as Cyrillic (`voxiuqfaiw` becomes `мщчшгйафшц`). Use digits only for the test password, or paste it (see `scripts/sim/README.md`). The tool loses short taps: use a duration of at least 0.2 s. Its `touch_path` and `swipe` are no good for checking gestures in sheets: a real gesture needs `app_drag` through control of the Simulator window.
- **No `UNSAFE_getAllByType` on `screen`.** The installed `@testing-library/react-native` does not have `screen.UNSAFE_getAllByType`. To check the order of elements on the screen, use `screen.getAllByText(/./)` and compare positions (see `apps/mobile/src/components/RecipientLabelSheet.test.tsx`).
