# Guide: the whole task, step by step

This guide is for a person who is new to this. It tells you what the task asked, what was built, what each file does, how to run it, how to show it, and what to do until the submission. The words are simple on purpose.

Contents

1. [The task in one minute](#1-the-task-in-one-minute)
2. [Words you need to know](#2-words-you-need-to-know)
3. [What was asked](#3-what-was-asked)
4. [What was built, in the order it was built](#4-what-was-built-in-the-order-it-was-built)
5. [Every file and what it does](#5-every-file-and-what-it-does)
6. [What happens when you press a button](#6-what-happens-when-you-press-a-button)
7. [The 7 cases and where each one is handled](#7-the-7-cases-and-where-each-one-is-handled)
8. [How to run it on your computer](#8-how-to-run-it-on-your-computer)
9. [How to show that it works](#9-how-to-show-that-it-works)
10. [The tests](#10-the-tests)
11. [How to record the video](#11-how-to-record-the-video)
12. [From finished code to submitted](#12-from-finished-code-to-submitted)
13. [Questions you may get in the live call](#13-questions-you-may-get-in-the-live-call)

---

## 1. The task in one minute

People who live in the same home share bills, like electricity or internet. One bill has to be cut into parts, one part for each person. Each person pays only their own part.

The task is to build this as a small app:

- A **home** has **members**.
- Someone adds a **bill** with a total amount. The app cuts it into **shares**, one for each member.
- Each member can **pay** their share. A share can be paid only one time.
- A **web page** shows the bills and lets people press Pay.

The app is small on purpose. The people who check it do not want many features. They want it to be **correct** and **safe** when things go wrong, for example when the same payment is sent two times, or two people press Pay at the same moment.

## 2. Words you need to know

| Word                 | Simple meaning                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API                  | The part of the app that has no screen. The web page sends it messages and it answers. Example: "add this member" and the API says "done".                                    |
| Endpoint             | One address of the API, like `/api/homes`. Each one does one job.                                                                                                             |
| Request and response | The message the page sends, and the answer it gets back.                                                                                                                      |
| Status code          | A number in the answer. `200` or `201` means it worked. `400` or `422` means the message was wrong. `404` means not found. `409` means a clash. `500` means the server broke. |
| JSON                 | A way to write data as text, like `{ "name": "Meera" }`.                                                                                                                      |
| Database             | The place where the data is kept, so it is not lost. Here it is Cloudflare D1, which is SQLite.                                                                               |
| Table                | One list in the database. Here: homes, members, bills, shares, payments.                                                                                                      |
| Migration            | A file with SQL that makes the tables. It is in `api/migrations/`.                                                                                                            |
| Constraint           | A rule inside the database that stops wrong data. Example: an amount cannot be below 0. Even a bug in the code cannot break it.                                               |
| Primary key          | A column whose value is different in every row. Two rows cannot have the same one.                                                                                            |
| Foreign key          | A column that points to a row in another table. The database makes sure the row exists.                                                                                       |
| Cents                | Money as whole numbers. 10 dollars is `1000` cents. We do not use decimals for money because computers cannot write numbers like 0.1 exactly.                                 |
| Transaction          | A group of database steps that all work, or none of them work.                                                                                                                |
| Idempotency key      | A random text the page sends with a payment. If the same key comes again, the server knows it is the same payment and does not do it twice.                                   |
| Race condition       | A bug that shows only when two requests come at the same moment.                                                                                                              |

## 3. What was asked

**The tools to use.** Hono on Cloudflare Workers for the API. Cloudflare D1 for the database. React, Vite and TanStack Router for the page. TypeScript everywhere, with no `any`. Vitest for tests. Biome for code style. The commands `pnpm check`, `pnpm typecheck` and `pnpm test` must pass.

**Part 1: homes and members**

- `POST /api/homes` with `{ "name": "..." }` makes a home. Answer: `201` with `{ id, name }`.
- `POST /api/homes/:homeId/members` with `{ "name": "..." }` adds a member. Answer: `201` with `{ id, homeId, name }`. If the home does not exist: `404`.

The order in which members are added is important in Part 2.

**Part 2: bills**

- `POST /api/homes/:homeId/bills` with `{ "title": "...", "totalCents": 1000 }` makes a bill and cuts it into shares. Answer: `201`. Errors: `404` if there is no such home. `422` if the total is not a whole number above 0, or if the home has no members.
- `POST /api/bills/:billId/shares/:shareId/pay` with the header `Idempotency-Key` pays one share. Errors: `400` if the key is missing, `404` if the bill or share is not found, `409` if the share was already paid with a different key.
- `GET /api/homes/:homeId/balances` shows how much each member still has to pay.

**The rules**

- The shares must always add up to the total.
- If the total does not divide evenly, the extra cents go to the first members, one cent each, in the order they joined. Example: 1000 cents between 3 people is `334`, `333`, `333`.
- The same payment sent again must give the same answer and must not pay again.
- If two requests pay the same share at the same time, only one can work.
- Balances are listed in the order the members joined.

**The database.** The tables must be made by SQL files in `api/migrations/`. There must be at least 3 named constraints.

**Errors.** Every error answer is JSON, like `{ "error": "message" }`.

**The web page.** It must show the bills and their shares, let a member pay a share, and show loading, empty and error states. If a payment fails, the share stays unpaid and an error shows. The page must not crash when the API fails or is slow.

**The rules for the tests.** The tests that came with the task are in `api/test`. They must not be changed. The same for `api/test/helpers.ts`. Extra tests are run later by the people who check, so the 7 cases below must really work.

## 4. What was built, in the order it was built

The work was done in small steps. Each step has its own commit in the git history.

1. **The tables** (`api/migrations/0001_init.sql`). Five tables: `homes`, `members`, `bills`, `shares`, `payments`. Their rules are written as named constraints. This was first because everything else depends on it.
2. **The routes and the input checks** (`api/src/`). All the endpoints, one shared place for checking input (`http.ts`), one small function for cutting cents (`cents.ts`), and JSON for every error, including routes that do not exist.
3. **My own tests** (`api/test/rules.test.ts`). 19 tests for the cases that the task listed. The tests that came with the task were not touched.
4. **The web pages** (`web/src/`). A page that lists the homes, and a page for one home with members, what is left to pay, a form for a bill, and the bills with Pay buttons.
5. **The write-up** (`README.md`, this guide, and the pictures in `docs/`).

## 5. Every file and what it does

### The database

**`api/migrations/0001_init.sql`**

| Table      | What it keeps                                                                          | Rules in it                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homes`    | one row for each home: `id`, `name`                                                    | The name cannot be empty (`ck_homes_name_has_text`).                                                                                                                                                                                  |
| `members`  | the people in a home. `join_no` is 0 for the first person, 1 for the second, and so on | The name cannot be empty. A home cannot have two members with the same `join_no` (`uq_members_join_no`). `home_id` must be a real home (`fk_member_belongs_to_home`).                                                                 |
| `bills`    | one row for each bill: `title`, `total_cents`, `created_at`                            | `total_cents` must be a whole number above 0 (`ck_bills_total_over_zero`). The title cannot be empty. `home_id` must be a real home.                                                                                                  |
| `shares`   | one row for each member for each bill: `amount_cents`                                  | A member has only one share in a bill (`uq_one_share_per_member_per_bill`). The bill and the member must be in the same home (`fk_shares_bill_in_home` and `fk_shares_member_in_home`). The amount must be a whole number, 0 or more. |
| `payments` | one row for each paid share: `share_id`, `pay_key`, `paid_at`                          | `share_id` is the primary key, so a share can only get one payment row. The key cannot be empty.                                                                                                                                      |

A share is "paid" when it has a row in `payments`. This is the main idea of the whole solution. Read section 6 to see why.

### The API (`api/src/`)

**`index.ts`.** The starting point. It joins the routes, gives `/api/health`, and sets two catch-all handlers. One answers `{ "error": "No such route" }` with `404` for any address that does not exist. The other turns any error into JSON. Errors we raise on purpose keep their status code. Any other error becomes `500` with `{ "error": "Unexpected server error" }`. So the API never answers with a plain text error.

**`http.ts`.** Small helpers that the routes share:

- `reject(code, message)` stops the request with an error status and a message.
- `parseBody` reads the JSON body. If the body is not valid JSON, or not an object, the answer is `400`.
- `cleanName` removes spaces from the start and the end of a name. It must be text with 1 to 100 characters, or the answer is `422`.
- `checkTotal` makes sure the amount is a whole number above 0 that a computer can hold exactly. It uses `Number.isSafeInteger`. This one check refuses `10.5`, `"100"`, `null`, `0`, `-5` and a huge number like `2 ** 53`.
- `homeOr404` looks for a home and answers `404` if it is not there.

**`cents.ts`.** One function, `divideCents(total, people)`. Each person gets `Math.floor(total / people)`. The cents that are left are given one each to the first people. Example: 1000 and 3 gives `334, 333, 333`. The numbers always add up to the total.

**`routes/homes.ts`.** Everything that starts with `/api/homes`:

- `GET /` lists the homes. The page needs it for the first screen.
- `POST /` makes a home.
- `GET /:homeId` gives one home with its members in join order.
- `POST /:homeId/members` adds a member. The `join_no` is counted inside the same SQL statement that adds the row (`SELECT COUNT(*)`), so the number and the row are made in one step.
- `POST /:homeId/bills` makes a bill. It checks the input, loads the members in join order, refuses if there are none (`422`), cuts the cents, and saves the bill with all its shares inside `DB.batch()`. `batch` is one transaction, so a bill without its shares can never be left in the database.
- `GET /:homeId/bills` lists the bills of a home, newest first, with the shares and the `paidAt` of each.
- `GET /:homeId/balances` adds up the unpaid shares of each member. A share counts as unpaid when it has no row in `payments`.

The page needs three of these (`GET /`, `GET /:homeId`, `GET /:homeId/bills`) and the task did not list them. They were added.

**`routes/bills.ts`.** One route, the payment. It does five things in order:

1. It reads the `Idempotency-Key` header. If it is missing, empty or longer than 200 characters: `400`.
2. It runs `INSERT INTO payments ... SELECT ... WHERE id = ? AND bill_id = ? ON CONFLICT (share_id) DO NOTHING`. This adds a payment row only if the share exists in this bill, and only if the share has no payment row yet.
3. It reads the share back together with its payment.
4. If the share was not found: `404`.
5. If the key saved in the payment is not the key that came in: `409`. Otherwise it answers `200` with the payment.

### The web page (`web/src/`)

**`server.ts`.** The only place in the page that talks to the API. It has one function, `callServer`, and a small function for each endpoint. `callServer` does these things:

- It gives up after 8 seconds (`GIVE_UP_AFTER_MS`) and says "The server took too long to answer."
- If the network is down it says "Could not reach the server."
- If the API sends an error, it shows the `error` text from the JSON. If the answer is not JSON at all, it shows "The server answered with status 500." or similar.
- Because of this, the page always gets a clear message and never crashes on a bad answer.

**`useAsync.ts`.** A small React hook. It runs a loading function and gives back one of three states: `loading`, `failed` (with a message) or `ready` (with the data). `reloadAll` loads again, and keeps the old data on the screen meanwhile, so the page does not jump back to "Loading" after each payment. `startOver` is for the Try again button.

**`cents.ts`.** Two small functions for money on the page:

- `showMoney(1050)` gives `$10.50`.
- `typedToCents("25.50")` gives `2550`. It cuts the text into the dollar part and the cent part. It does not multiply a decimal number, because decimals are not exact. It gives `null` for anything that is not an amount with at most 2 decimals, and for 0.

**`routes/index.tsx`.** The first page, `/`. It lists the homes with loading, empty and error states, and has a form to add a home.

**`routes/home.$homeId.tsx`.** The main page, `/home/:homeId`. It has four blocks:

- Members: the list, and a form to add one.
- Still to pay: how much each member still owes.
- Add a bill: title and amount in dollars. The button is disabled while the home has no members.
- Bills: each bill with its shares. A share shows either "Paid on <date>" or a Pay button. If a payment fails, a message shows under that share and it says the share is still unpaid.

In this file, `payKeys` (a `useRef` map) keeps one idempotency key for each share. The key is made on the first click and removed only when the payment works. That is what makes "press Pay again" safe.

**`main.tsx`, `routes/__root.tsx`, `routeTree.gen.ts`, `app.css`, `index.html`.** The setup of the router, the page frame and the styles. `routeTree.gen.ts` is made by TanStack Router and should not be edited by hand.

### Tests and pictures

**`api/test/rules.test.ts`.** The 19 tests that were added. See section 10.

**`docs/home.png` and `docs/payment-error.png`.** The two pictures used in the README.

## 6. What happens when you press a button

### Adding a bill of 10.00 in a home with 3 members

1. You type `Electricity` and `10.00` and press Add bill.
2. The page changes `10.00` into `1000` with `typedToCents`. If you typed something wrong, like `abc` or `-5`, it shows a message and sends nothing.
3. The page sends `POST /api/homes/<id>/bills` with `{ "title": "Electricity", "totalCents": 1000 }`.
4. The API checks the home, the title and the total.
5. It loads the members in join order and cuts the cents: `334, 333, 333`.
6. It saves the bill and the 3 shares in one transaction.
7. It answers `201`. The page loads everything again, so the new bill shows with the three shares.

### Paying a share

1. You press Pay. The page makes a random key for this share, and keeps it.
2. It sends `POST /api/bills/<billId>/shares/<shareId>/pay` with the header `Idempotency-Key: <the key>`.
3. The API tries to add a row in `payments`. Only one row can ever exist for this share.
4. The API reads the share and compares the saved key with the key it got:
   - the same key: answer `200`. This is true both for the first request and for the same request sent again.
   - a different key: answer `409`. Somebody else paid first.
5. When the answer is `200` the page deletes its saved key and loads everything again. The share now shows "Paid on ...".

### Why a payment is a row and not a column

The first idea is to put a `paid` column on the share and write code like this: "if it is not paid, mark it paid". The problem is that two requests can both read "not paid" before either one writes. Then both pay.

A primary key cannot be passed twice. The database itself says no to the second row, even if both requests come at the same moment. The code does not have to be careful. This is also why the code uses `ON CONFLICT DO NOTHING` and then reads the row back. After that read, the code knows who really won.

### Why the page keeps the key until the payment works

Say the server saves the payment, but the answer is lost on the way back (a bad network, for example). The page shows an error, because it did not hear back. The share looks unpaid. When you press Pay again, the page sends the same key. The server finds its own key on the payment and answers `200` with the same payment. Nothing is paid twice. If the page had made a new key on every click, the server would answer `409`, and you would be told a paid share was already paid.

The keys live in memory only. If you reload the page, they are forgotten.

## 7. The 7 cases and where each one is handled

| #   | Case                                             | What happens                                                                                                                                | Where                                                              |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | A home with no members                           | `422`. On the page, the Add bill button is disabled and a hint says to add a member.                                                        | `routes/homes.ts` (bills route), `home.$homeId.tsx`                |
| 2   | An amount that is 0, negative or not whole       | `422`. The page also refuses it before sending.                                                                                             | `http.ts` (`checkTotal`), `bills` check in SQL, `web/src/cents.ts` |
| 3   | An amount that does not divide evenly            | 1000 between 3 gives 334, 333, 333.                                                                                                         | `cents.ts`                                                         |
| 4   | The same payment sent twice                      | The second one gets `200` with the same `paidAt`. Only one row exists.                                                                      | `routes/bills.ts`                                                  |
| 5   | Two requests pay the same share at the same time | One wins. With different keys the other gets `409`. With the same key both get `200` with the same payment.                                 | `payments.share_id` primary key, `routes/bills.ts`                 |
| 6   | A bill or share that does not exist              | `404`. Also when the share exists but is in another bill.                                                                                   | `routes/bills.ts`, `http.ts` (`homeOr404`)                         |
| 7   | The API answers `500` or is slow                 | Every error is JSON. The page gives up after 8 seconds, shows the message and a Try again button. A failed payment leaves the share unpaid. | `index.ts`, `web/src/server.ts`, `home.$homeId.tsx`                |

## 8. How to run it on your computer

You need Node 22 or newer (the tool that runs the API needs it), and pnpm.

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts two things at once:

- the API at http://localhost:8787
- the web page at http://localhost:5173

It also makes the local database from the migration files before it starts. Open http://localhost:5173 in the browser.

To check that the API is alive, open http://localhost:8787/api/health. You should see `{"status":"ok"}`.

If pnpm says that some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

The other commands:

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm test`      | Runs all tests (43).                                  |
| `pnpm check`     | Biome checks the code style. Must pass.               |
| `pnpm typecheck` | TypeScript checks the types in both parts. Must pass. |
| `pnpm build`     | Makes the production build of the page.               |

The people who check will run `pnpm install && pnpm check && pnpm typecheck && pnpm test`. Run this same line yourself before you submit.

## 9. How to show that it works

### On the page

1. Open http://localhost:5173. You see "Your homes" and an empty list.
2. Add a home called `Flat 12`. You go to its page.
3. Try to add a bill now. The button is disabled, and a hint says to add a member first. This is case 1.
4. Add three members: `Meera`, `Kabir`, `Tara`.
5. Add a bill: title `Electricity`, amount `10.00`. The shares are `$3.34`, `$3.33`, `$3.33`. The extra cent went to Meera, who joined first. This is case 3.
6. Look at "Still to pay". It shows the same amounts.
7. Press Pay on Meera's share. It changes to "Paid on <date>". Her amount in "Still to pay" goes down.
8. Try an amount like `abc`, `-5`, `0` or `1.234`. The page shows a message and does not send it. This is case 2.

### Showing a failure on the page

Stop the API (press Ctrl+C in the terminal that runs `pnpm dev`, or stop only the api part). Press Pay on a share. The page shows a message under the share, says it is still unpaid, and does not crash. Start the API again and press Pay again. It works.

### With the API only (curl)

Open a second terminal while `pnpm dev` is running.

```bash
# make a home and keep its id
curl -s -X POST localhost:8787/api/homes -H 'Content-Type: application/json' -d '{"name":"Flat 12"}'

# add a member (put the home id in the address)
curl -s -X POST localhost:8787/api/homes/HOME_ID/members -H 'Content-Type: application/json' -d '{"name":"Meera"}'

# add a bill of 10.00
curl -s -X POST localhost:8787/api/homes/HOME_ID/bills -H 'Content-Type: application/json' -d '{"title":"Electricity","totalCents":1000}'

# pay a share: use the bill id and share id from the answer above
curl -s -i -X POST localhost:8787/api/bills/BILL_ID/shares/SHARE_ID/pay -H 'Idempotency-Key: my-key-1'
```

Now try the cases:

- Run the pay line again with the same key. You get `200` and the same `paidAt`. (case 4)
- Run it with `Idempotency-Key: my-key-2`. You get `409`. (case 5, different key)
- Run it with no `Idempotency-Key` header. You get `400`.
- Use a share id that does not exist. You get `404`. (case 6)
- Send `{"title":"x","totalCents":10.5}` to the bills address. You get `422`. (case 2)
- Open `localhost:8787/api/nothing`. You get `{"error":"No such route"}`. (case 7)

### With the tests

Run `pnpm test`. All 43 should pass. Section 10 explains what they check.

## 10. The tests

`pnpm test` runs 43 tests inside the same kind of environment as Cloudflare Workers. 24 tests came with the task and are not changed. 19 are in `api/test/rules.test.ts`. They check:

- 5 cents between 7 people gives `1,1,1,1,1,0,0`.
- 6 members added at the same moment still get 6 different, clean join numbers.
- Two requests paying the same share at the same time, with different keys (one `200` and one `409`) and with the same key (both `200`, one payment).
- The first key still works after another key was turned down.
- A share asked for through the wrong bill gives `404`.
- A key of 201 characters gives `400`. A request with no key gives `400` and the share stays unpaid.
- A home name that is empty, only spaces, a number, missing, or 101 characters long gives `422`.
- A body that is not JSON gives `400` and the answer is still JSON.
- A total of `2 ** 53` gives `422`.
- A bill with a blank title gives `422`.
- A route that does not exist answers `404` in JSON.
- A home with no bills shows `0` for everybody.
- Bills are listed newest first and shares in join order.

**Does the payment test really protect the code?** To find out, the payment `INSERT` was changed from `DO NOTHING` to `DO UPDATE`, so the last request would overwrite the first one. 5 tests failed. It was changed back and all 43 passed again.

The page has no automated tests. It was used in a browser. These problems were made on purpose: a `500` when paying, an answer lost after the server saved the payment, a request slower than the 8 second limit, a `500` when loading, and an answer that was not JSON. Each time the page showed a message and did not crash.

## 11. How to record the video

The video is 3 minutes or less. Use Loom or an unlisted YouTube video. Make sure anyone with the link can open it. Test the link in a private window.

What the people who check want to see: the architecture, the data flow, and one trade-off.

A plan that fits 3 minutes:

| Time         | Show                                                                                                            | Say                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 0:00 to 0:25 | README and the folders `api/` and `web/`                                                                        | What the app is, and the tools used.                                                                                           |
| 0:25 to 0:55 | The page: add a bill of 10.00 with 3 members                                                                    | The amount becomes cents. The API cuts it into 334, 333, 333. The page loads again from the server.                            |
| 0:55 to 1:25 | `homes.ts` (`divideCents`, `DB.batch`), then the `shares` table in the migration                                | The bill and its shares are saved together. The foreign keys stop a share from joining a bill and a member of different homes. |
| 1:25 to 2:10 | The `payments` table, then `routes/bills.ts`                                                                    | The trade-off: a payment is a row with `share_id` as primary key. Explain `ON CONFLICT DO NOTHING` and the saved key check.    |
| 2:10 to 2:45 | `web/src/server.ts` (the 8 second limit), `payKeys` in `home.$homeId.tsx`, and a failing payment in the browser | The page does not crash, the share stays unpaid, and the same key is used on the next try.                                     |
| 2:45 to 3:00 | The terminal with `pnpm test`                                                                                   | All tests pass.                                                                                                                |

Tips: close other windows, make the editor font big, say each thing slowly, and practise once before you record.

## 12. From finished code to submitted

Do these in order.

1. **Run everything once.** `pnpm install && pnpm check && pnpm typecheck && pnpm test && pnpm build`. All must pass.
2. **Check that the visible tests are not changed.** The files in `api/test` that came with the task (`homes.test.ts`, `bills.test.ts`, `payments.test.ts`, `helpers.ts`) must be the same as the original. `git diff` against the template should show no change in them.
3. **Check the README.** It must have the section called **Decisions** with 3 decisions and why. It has.
4. **Make sure the repository is public**, so the people who check can open it.
5. **Check that everything is pushed.** Run `git status`, it should be clean. Open the repository page in a private window and look at the code and the README.
6. **Record the video** (section 11) and copy the link.
7. **Fill in the application form.** Paste the repository link and the video link. Answer the other questions on the form yourself, in your own words.
8. **Prepare for the live call.** Read section 13. Be ready to open any file and say what it does.

## 13. Questions you may get in the live call

**Why do you use cents and not decimals?**
Decimal numbers cannot hold values like 0.1 exactly. With whole cents, all the adding and cutting is exact, and the shares always add up to the total.

**What stops a share from being paid twice?**
The `payments` table has `share_id` as its primary key. The database refuses a second row for the same share, even when two requests come at the same moment.

**What does the idempotency key do?**
It tells the server that a request is a repeat of an earlier one. If the key saved on the payment is the same as the one that came in, the server just answers with the payment it already has.

**What if the server saved the payment, but the answer was lost?**
The page keeps the key for that share until a payment works. The next click sends the same key, and the server answers `200` with the saved payment. Nothing is paid twice.

**Why `409` for a different key?**
It means "this share was already paid by another request". It is not the same as a repeat of the same request.

**Why is the bill saved with `DB.batch()`?**
So the bill and all its shares are one transaction. If one share cannot be saved, nothing is saved. A bill without shares cannot exist.

**How are the extra cents given?**
Each person gets the whole part of `total / people`. The cents that are left are given one each to the first people, in the order they joined. That order is `join_no`.

**Why is `join_no` a number and not the time of creation?**
Two members can be added in the same millisecond, so time is not a safe order. `join_no` is counted inside the insert, and `UNIQUE (home_id, join_no)` stops a clash.

**Which constraints did you write, and what does each stop?**
- `ck_bills_total_over_zero`: a bill with 0, a negative or a decimal total.
- `uq_one_share_per_member_per_bill`: a member getting two shares in one bill.
- `fk_shares_bill_in_home` and `fk_shares_member_in_home`: a share that joins a bill and a member from two different homes.
- `uq_members_join_no`: two members with the same join number in a home.
- `ck_homes_name_has_text` and the other name checks: empty names.
- `payments.share_id` primary key: two payments for one share.

**What can the database not check?**
That the shares add up to the total. A `CHECK` in SQLite cannot look at other rows. That rule is only in the code and in the tests.

**What would you do with more time?**
Add automated tests for the page, remove or edit members and bills (this needs a new rule for `join_no`), and keep the payment keys in browser storage so a reload does not forget them.

**What does the page do when the API is slow or broken?**
Every request stops after 8 seconds. The page shows the error text from the API, or a clear message if there is none, and a Try again button. A failed payment leaves the share unpaid.
