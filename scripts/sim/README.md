# The simulator stand

A local server with invented data, for looking at the app in the iPhone simulator. The real server and real data take no part in it. Docker is not needed: Postgres comes from `embedded-postgres`, as in the tests.

Node 22 is needed: `source ~/.nvm/nvm.sh && nvm use 22`. If the agent's environment rejects that command: `PATH="$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node | grep '^v22' | sort -V | tail -1)/bin:$PATH" scripts/sim/up.sh`, and the same in front of `node scripts/sim/sql.mjs` and `down.sh`.

## Starting and stopping

1. `scripts/sim/up.sh` — a database on port 55432, migrations, data from `seed.sql`, the server on `http://localhost:3100`. The one-time password is in `.sim/password` (digits only: the simulator types in the Russian layout). Do not put the password into chat or into repository files.
2. Metro, in the background: `cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:3100 ./node_modules/.bin/expo start --dev-client --clear --port 8082`. Do not start a second Metro on the same port. If the port is already taken, the running Metro may be used only after checking that it was started from this copy and points at the stand, in one line: `pid=$(lsof -ti tcp:8082 -sTCP:LISTEN); lsof -a -p $pid -d cwd -Fn; ps eww -p $pid | tr ' ' '\n' | grep EXPO_PUBLIC_API_URL` — the `lsof -a` command must show this copy's `apps/mobile`, the `ps` command `http://localhost:3100`. If either is not confirmed, do not use it: a Metro with another address sends the app to another server. Metro shows this copy's code: what was merged into `main` is visible after `git pull`.
3. The iPhone 17 Pro simulator with the dev build `com.irozhok.hale` installed: `xcrun simctl boot "iPhone 17 Pro"`, then `xcrun simctl openurl booted "exp+hale://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"`.
4. After the check: `lsof -ti tcp:8082 -sTCP:LISTEN | xargs kill` (`pkill -f "expo start"` does not find this process) and `scripts/sim/down.sh` (stops everything and wipes `.sim/` together with the password).

## Data

Every date in `seed.sql` is counted from today in Kyiv, so the picture is the same on any day: income in 8 days, a ₴2,000 limit with ₴760 spent, a reserve of ₴5,000, two payments before the income, a week within the limit, yesterday ₴340 left of a ₴1,960 limit.

- A shortage before the income: `node scripts/sim/sql.mjs scripts/sim/short.sql`, then pull «Сегодня» down.
- A loan, a FOP account and café spending older than a week and older than a month: `node scripts/sim/sql.mjs scripts/sim/extra.sql` on top of `seed.sql`. Needed for «Займы» in «План», the line «в том числе ФОП» and the «Месяц» period in the filters. The picture is different afterwards (the reserve to the income is ₴12,000, not ₴5,000); the file will not run twice in a row (the `sim-fop` account already exists) — restore the base with `seed.sql` first.
- Your own scenario: write SQL next to these and run it the same way. Restore the base: `node scripts/sim/sql.mjs scripts/sim/seed.sql`.

## How to tap in the simulator

- The screen is 402×874 points. Login: the password field (200, 448), type the password, wait 2.5 s, «Войти» (200, 507). The password can be pasted instead of typed, and then it never appears in tool calls: `xcrun simctl pbcopy booted < .sim/password`, tap the field twice with a 2 s pause, then «Paste» in the menu that appears (55, 492).
- The menu at the bottom, y≈812: «Сегодня» x≈74, «Операции» x≈169, «План» x≈264, «+» x≈352.
- Make taps 0.1–0.2 s long and wait 2 s before a screenshot, otherwise the screenshot shows the screen from before the tap.
- The grey gear on the right is the dev build's button, not part of the app.
- There is one simulator: one agent at a time checks screens.
