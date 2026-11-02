-- D1 always enforces foreign keys, so the FOREIGN KEY constraints below are checked on every write.

CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 0, 1, 2... per home. Decides who gets the extra cents and the order of balances.
  position INTEGER NOT NULL,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT members_position_unique UNIQUE (home_id, position),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT bills_total_positive_integer CHECK (typeof(total_cents) = 'integer' AND total_cents > 0),
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0)
);

CREATE INDEX bills_home_idx ON bills (home_id, created_at);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  -- The key of the request that paid this share. A retry with the same key gets the same answer.
  idempotency_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members (id),
  CONSTRAINT shares_one_per_member UNIQUE (bill_id, member_id),
  -- 0 is allowed: 2 cents between 3 members gives 1, 1, 0.
  CONSTRAINT shares_amount_not_negative CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  CONSTRAINT shares_paid_with_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX shares_member_idx ON shares (member_id);
