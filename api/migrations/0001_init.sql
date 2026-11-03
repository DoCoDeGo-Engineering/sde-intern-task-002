CREATE TABLE homes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT homes_id_unique UNIQUE (id),
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  CONSTRAINT members_id_unique UNIQUE (id),
  CONSTRAINT members_id_home_unique UNIQUE (id, home_id),
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX members_home_idx ON members (home_id, seq);

CREATE TABLE bills (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  CONSTRAINT bills_id_unique UNIQUE (id),
  CONSTRAINT bills_id_home_unique UNIQUE (id, home_id),
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT bills_total_positive_integer CHECK (typeof(total_cents) = 'integer' AND total_cents > 0)
);

CREATE INDEX bills_home_idx ON bills (home_id, seq);

CREATE TABLE shares (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  bill_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_id_unique UNIQUE (id),
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_bill_same_home_fk FOREIGN KEY (bill_id, home_id) REFERENCES bills (id, home_id),
  CONSTRAINT shares_member_same_home_fk FOREIGN KEY (member_id, home_id)
    REFERENCES members (id, home_id),
  CONSTRAINT shares_amount_nonnegative_integer CHECK (
    typeof(amount_cents) = 'integer' AND amount_cents >= 0
  ),
  CONSTRAINT shares_payment_complete CHECK ((paid_at IS NULL) = (idempotency_key IS NULL))
);

CREATE INDEX shares_member_idx ON shares (member_id);
