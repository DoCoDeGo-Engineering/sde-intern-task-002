# Acknowledgements and Decisions

## AI use

AI tools were used to help draft code and explore the stack. Every line in the final
solution was reviewed, adapted, and is understood by the author. The visible tests
and `api/test/helpers.ts` were not modified.

## Decisions

1. **Atomic payments without explicit transactions.** Paying a share uses a single
   `UPDATE ... WHERE paid_at IS NULL` statement. SQLite serializes writes, so only one
   concurrent request can flip a share from unpaid to paid. A request that loses the race
   re-reads the share and answers `409` (already paid with a different key) or `200`
   (idempotent replay with the same key). This keeps "only one may succeed" without
   relying on multi-statement transactions across separate D1 calls.

2. **Idempotency key stored on the share.** The `idempotency_key` column remembers which
   key paid a share. Re-sending the same key returns `200` with the same `paidAt`;
   a different key on an already-paid share returns `409`. A missing key returns `400`.

3. **Uneven split gives extra cents to the earliest members.** `base = floor(total /
   count)`, `remainder = total % count`; the first `remainder` members get `base + 1`,
   the rest get `base`. Shares always sum to `totalCents`. Member order is the insertion
   order (a `position` column on `members`).

4. **Named constraints for data safety.** The schema has four named constraints:
   `fk_members_home`, `fk_bills_home`, `fk_shares_bill`, `fk_shares_member` (foreign keys
   with cascade), `uq_shares_bill_member` (one share per member per bill),
   `chk_bills_total_positive` (bill total must be positive), and
   `chk_shares_amount_non_negative` (share amount cannot be negative). These prevent
   orphaned rows, duplicate shares, and invalid amounts.

5. **Web page resilience.** Loading, empty, and error states are shown explicitly.
   Failed payments leave the share unpaid and surface an error without crashing. All API
   calls are wrapped in try/catch and invalid or non-JSON responses are handled.

6. **No `any` types.** TypeScript `strict` mode is enabled on both packages; all data
   is validated with type guards before use.
