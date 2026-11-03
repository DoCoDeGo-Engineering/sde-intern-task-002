# SDE Intern Assignment: Shared Bill Splitter

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## How to submit

1. Click **Use this template**, then **Create a new repository**. Make the repository **public**.
2. Build your solution in your new repository. Small, clear commits are welcome.
3. Update this README with a short section called **Decisions**. Write 3 decisions you made and why.
4. Record a video of **3 minutes or less** (Loom or unlisted YouTube). Show the architecture, the data flow, and one trade-off you made. Make sure anyone with the link can view it.
5. Paste the repository link and the video link in the application form.

We will run `pnpm install && pnpm check && pnpm typecheck && pnpm test` on your repository.

## Decisions

1. **Paying a share is one `UPDATE` with `WHERE paid_at IS NULL`.** My first idea was to read the share, check `paid_at` in code, and then write. That has a gap: two requests can both read "unpaid" before either one writes, and then both pay. So the check is inside the `UPDATE` itself. The database runs one write at a time, so only one request changes the row and gets it back with `RETURNING`. The other request gets nothing, then reads the share: same `Idempotency-Key` gives `200` with the saved result, a different key gives `409`, and no row gives `404`. The key is saved on the share row, so I do not need a second table. The trade-off is that a key only belongs to one share, and a repeated request gets the share as it is saved now, not a copy of the first answer.

2. **Member order is a `position` column, worked out inside the `INSERT`.** The order decides who gets the extra cents, so it must be stable. A timestamp can be the same for two members added in the same millisecond, and I did not want to depend on `rowid`. I first thought about reading the biggest position and adding 1 in code, but two members added together could then get the same number. So the `INSERT` has a sub-select for the next number, and `UNIQUE (home_id, position)` is there as a second guard. A test adds five members at the same time and checks that the order is still clean.

3. **A bill and its shares are saved together, and the database repeats the money rules.** `DB.batch()` runs all the statements as one transaction, so a bill can never exist without its shares. All money is whole cents. The split is `floor(total / count)` for everyone, then one extra cent for each of the first `total % count` members, so the shares always add up to the total. The input check uses `Number.isSafeInteger`, which refuses 10.5, strings, `null` and numbers too big to be exact. In the schema, `CHECK` rules refuse a total of 0 or less, and two foreign keys on `(bill_id, home_id)` and `(member_id, home_id)` make sure a share cannot join a bill and a member from different homes. The trade-off: "the shares add up to the total" is kept by the code, not by a constraint, because SQLite cannot check a sum over other rows in a `CHECK`.

## The cases from the list

1. **A home with no members:** the bill is refused with `422`. On the page, the "Add bill" button is disabled until there is a member.
2. **An amount that is zero, negative or not whole:** `422`. The page turns "25.50" into 2550 cents with text work, not with decimal numbers.
3. **An amount that does not divide evenly:** 1000 cents between 3 gives 334, 333, 333.
4. **The same payment sent twice:** same key gives `200` and the same `paidAt`. The share is paid once.
5. **Two payments for the same share at the same time:** one wins. With different keys the other gets `409`. With the same key both get `200` with the same result. Both cases have a test.
6. **A bill or share that does not exist:** `404`. A share that is asked for through the wrong bill is also `404`.
7. **The API answers with a 500 or is slow:** every error from the API is JSON (`{ "error": "..." }`), including the 500 and unknown routes. On the page, every request stops after 8 seconds and shows a message with a "Try again" button. A failed payment leaves the share unpaid and shows the error under it.

## The web page

There are two routes. `/` lists the homes and makes a new one. `/homes/$homeId` is the main page: members, what each member still has to pay, a form for a new bill, and the bills with their shares and a Pay button.

- The page does not change a share by itself. After a payment it asks the API again, so what is on the screen is what the server has.
- Each share gets one `Idempotency-Key` on the first click. If the answer is lost (for example the connection drops after the server already paid), the next click sends the same key, so the server answers with the saved payment and does not pay again. The keys are kept in memory, so a page reload forgets them.
- Besides the endpoints in the task, I added `GET /api/homes`, `GET /api/homes/:homeId` and `GET /api/homes/:homeId/bills`, because the page needs to read them.

## Where things are

```
api/migrations/0001_init.sql   tables and constraints
api/src/index.ts               the routes and the error handlers
api/src/validate.ts            reads and checks the request body
api/src/split.ts               the split of cents
api/test/edge.test.ts          my own tests (the visible tests are not changed)
web/src/api.ts                 requests with a timeout and error messages
web/src/useLoad.ts             loading, error and ready states
web/src/routes/                the two pages
```

## Tests

`pnpm test` runs 43 tests: the 24 visible ones and 19 of mine in `api/test/edge.test.ts`. Mine cover the 2 cents between 3 members case, members added at the same time, two payments at the same time (different keys and same key), a share paid through the wrong bill, a key that is too long, names that are empty, only spaces or too long, a body that is not JSON, a total of `2 ** 53`, an unknown route, and the order of bills and shares.

To check that the payment tests really catch the problem, I removed `AND paid_at IS NULL` from the `UPDATE`. Four tests failed. I put it back and all 43 pass again.

For the page I did not write automated tests. I clicked through it in a browser and also made the failures happen on purpose: a 500 on payment, a lost answer after the server paid, a request slower than the timeout, a 500 on load, and an answer that is not JSON.

## Screenshots

The main page:

![Home page with members, balances and bills](docs/home.png)

A payment whose answer was lost. The share stays unpaid and the page says so. Clicking Pay again sends the same key:

![Payment error under a share](docs/payment-error.png)
