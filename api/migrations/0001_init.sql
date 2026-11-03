CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

/*
  position is 0, 1, 2 ... inside one home. It tells who was added first.
  The first members get the extra cents when a bill does not divide evenly.
*/
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT members_position_unique UNIQUE (home_id, position),
  CONSTRAINT members_id_home_unique UNIQUE (id, home_id)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT bills_total_positive CHECK (typeof(total_cents) = 'integer' AND total_cents > 0),
  CONSTRAINT bills_id_home_unique UNIQUE (id, home_id)
);

CREATE INDEX bills_home_idx ON bills (home_id, created_at);

/*
  home_id is repeated here so the two foreign keys can check that the bill and
  the member belong to the same home.
  A share is paid when paid_at is set. The key of the request that paid it is
  saved next to it, so the same request sent again can be recognised.
*/
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_bill_home_fk FOREIGN KEY (bill_id, home_id) REFERENCES bills (id, home_id),
  CONSTRAINT shares_member_home_fk FOREIGN KEY (member_id, home_id) REFERENCES members (id, home_id),
  CONSTRAINT shares_one_per_member UNIQUE (bill_id, member_id),
  CONSTRAINT shares_amount_not_negative CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0),
  CONSTRAINT shares_paid_with_key CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX shares_member_idx ON shares (member_id);
