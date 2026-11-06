# Shared Bill Splitter

A small bill splitter for a shared home, built for the SDE intern assignment. A home has members, a bill is split between them, and each member pays their own share.

Stack: Hono on Cloudflare Workers, Cloudflare D1 (SQLite), React, Vite, TanStack Router, TypeScript, Vitest and Biome.

## What was asked

**Part 1, homes and members.** Create a home and add members to it. The order in which members are added matters later.

- `POST /api/homes` with `{ name }` gives `201 { id, name }`
- `POST /api/homes/:homeId/members` with `{ name }` gives `201 { id, homeId, name }`, or `404` if the home is not found

**Part 2, bill splitting.** All money is whole cents.

- `POST /api/homes/:homeId/bills` with `{ title, totalCents }` splits the bill between all members and gives `201` with the shares. `404` if the home is not found. `422` if the total is not a positive whole number or the home has no members.
- `POST /api/bills/:billId/shares/:shareId/pay` with an `Idempotency-Key` header marks one share as paid. `400` if the key is missing. `404` if the bill or share is not found. `409` if the share was already paid with a different key.
- `GET /api/homes/:homeId/balances` gives what each member still has to pay, in the order they were added.

**Rules.** The shares always add up to the total. When it does not divide evenly, the extra cents go to the first members one by one (1000 cents between 3 gives 334, 333, 333). The same key sent again gives the same answer and does not pay twice. If two requests pay the same share together, only one may succeed.

**Database.** Schema as SQL migrations in `api/migrations/`, with at least 3 named constraints. Every error is JSON, `{ "error": "message" }`.

**Web page.** One page that shows the bills and their shares, lets a member pay a share, and shows loading, empty and error states. A failed payment keeps the share unpaid and shows an error. The page must not crash when the API fails or is slow.

**Cases to handle.** A home with no members, an amount that is zero, negative or not whole, an amount that does not divide evenly, the same payment sent twice, two members paying the same share together, a bill or share that does not exist, and a 500 or slow API.

**Other rules.** `pnpm check`, `pnpm typecheck` and `pnpm test` must pass. TypeScript with no `any`. The visible tests in `api/test` and `api/test/helpers.ts` must not be changed.

## What I did

I built the database, the API and the web page, and wrote the README sections below. All 24 visible tests pass, and I did not change them. I added 19 tests of my own. `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.

## Run it

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
pnpm test         # 43 tests
pnpm check        # Biome
pnpm typecheck    # tsc on both packages
pnpm build        # production build of the web app
```

Wrangler needs Node 22 or newer. Open http://localhost:5173 after `pnpm dev`.

## Decisions

1. **A payment is a row in its own `payments` table, and `share_id` is its primary key.** I did not want to trust a check in code like "if the share is not paid yet, mark it paid", because two requests can both pass the check before either one writes. A primary key cannot be passed twice. To pay, the API runs `INSERT ... ON CONFLICT (share_id) DO NOTHING`, and then reads the share back with its payment. If the key saved in the payment is the one that came in the header, the answer is `200` with that payment. This is true for the request that paid, and also for the same request sent again. If the saved key is a different one, the answer is `409`. If the share is not found, the answer is `404`. The cost of this choice is one more table and a `LEFT JOIN` every time shares are read. In return, "paid" and "which key paid" cannot get out of step with each other.

2. **The order of the members is a number inside the home, set by the insert itself.** `members.join_no` is 0 for the first member, 1 for the second, and so on. The order matters because the first members get the extra cents. I did not use the time of creation, because two members can be added in the same millisecond. The `INSERT` counts the members of the home in a sub-select, so reading the count and writing the new row happen in one statement. Members cannot be removed in this app, so the count is always the next free number. `UNIQUE (home_id, join_no)` stops a clash if that ever changes.

3. **A bill and its shares are saved together, and some rules are repeated in the database.** `DB.batch()` saves the bill and every share as one transaction, so a bill without shares cannot exist. Money is whole cents everywhere. The cents are divided with `Math.floor(total / people)` for everybody, and the leftover cents go one each to the first people. The check on the incoming amount uses `Number.isSafeInteger`, which refuses 10.5, a string, `null` and a number too big to be exact. The database repeats this with `CHECK` rules. Each share also stores `home_id`, and two foreign keys compare it with the bill and with the member, so a share cannot connect a bill and a member from two different homes. What the database cannot check is that the shares add up to the total, because a `CHECK` in SQLite cannot look at other rows. That part is only in the code and in the tests.

## The 7 cases

1. **A home with no members.** The bill is refused with `422`. On the page, the Add bill button stays disabled until the home has a member.
2. **An amount that is zero, negative or not whole.** `422`. The page changes "25.50" to 2550 by cutting the text apart, not by multiplying a decimal number.
3. **An amount that does not divide evenly.** 1000 cents between 3 people gives 334, 333 and 333.
4. **The same payment sent twice.** The second one gets `200` and the same `paidAt`. Only one row exists in `payments`.
5. **Two requests paying the same share at the same time.** One request wins. If the keys are different, the other one gets `409`. If the key is the same, both get `200` with the same payment.
6. **A bill or share that does not exist.** `404`. This is also the answer when the share exists but belongs to another bill.
7. **The API answers with a 500 or is slow.** Every error comes as `{ "error": "..." }`, including a 500 and a route that does not exist. The page gives up on a request after 8 seconds and shows a message with a Try again button. A payment that fails leaves the share unpaid and shows the message under it.

## The page

`/` lists the homes and has a form for a new one. `/home/:homeId` is the main page. It shows the members, how much each member still has to pay, a form for a new bill, and the bills with their shares and a Pay button.

- After a payment the page asks the API for everything again. It does not change a share on the screen by itself, so the screen shows what the server has.
- A share gets its `Idempotency-Key` on the first click and keeps it until the payment works. Say the server records the payment but the answer never arrives. The next click sends the same key, the server answers with the payment it already has, and nothing is paid twice. The keys are only kept in memory, so reloading the page forgets them.
- The page needs three reads that the task does not list: `GET /api/homes`, `GET /api/homes/:homeId` and `GET /api/homes/:homeId/bills`. I added them.

## Files

```
api/migrations/0001_init.sql    the tables and their constraints
api/src/index.ts                puts the routes together, JSON for errors and unknown routes
api/src/routes/homes.ts         homes, members, bills, balances
api/src/routes/bills.ts         paying a share
api/src/http.ts                 reading and checking the input
api/src/cents.ts                dividing cents between people
api/test/rules.test.ts          my tests (the visible tests are not changed)
web/src/server.ts               calls to the API, with a time limit and readable errors
web/src/useAsync.ts             loading, failed and ready states
web/src/cents.ts                showing and reading money
web/src/routes/                 the two pages
```

## Tests

`pnpm test` runs 43 tests. 24 are the visible ones and 19 are mine in `api/test/rules.test.ts`. Mine cover: 5 cents between 7 people, 6 members added in the same moment, two requests paying together (different keys and the same key), the first key still working after another key was turned down, a share asked for through another bill, a key of 201 characters, a payment request with no key, home names that are empty, only spaces, a number, missing or too long, a body that is not JSON, a total of `2 ** 53`, a blank bill title, a route that does not exist, a home with no bills, and the order of bills and shares.

To check that the payment tests can really fail, I changed `DO NOTHING` to `DO UPDATE` in the payment `INSERT`, so the last request would overwrite the first. Five tests failed. I changed it back and all 43 pass.

I did not write automated tests for the page. I used it in a browser, and made these problems happen on purpose: a 500 when paying, an answer lost after the server had saved the payment, a request slower than the time limit, a 500 on loading, and an answer that was not JSON. The page showed a message each time and did not crash.

## Screenshots

The main page:

![Main page with members, what is left to pay and the bills](docs/home.png)

A payment whose answer was lost on the way back. The share still shows Pay and the page says it is unpaid. Pressing Pay again sends the same key:

![A lost answer shown under a share](docs/payment-error.png)
