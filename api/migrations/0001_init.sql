CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  CONSTRAINT ck_homes_name_has_text CHECK (trim(name) <> '')
);

/*
  join_no counts the members of one home: 0 for the first member, 1 for the
  second and so on. When a bill does not divide evenly, the members with the
  lowest join_no get the extra cents.
*/
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  join_no INTEGER NOT NULL,
  CONSTRAINT fk_member_belongs_to_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_members_name_has_text CHECK (trim(name) <> ''),
  CONSTRAINT uq_members_join_no UNIQUE (home_id, join_no),
  CONSTRAINT uq_members_id_home UNIQUE (id, home_id)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_bill_belongs_to_home FOREIGN KEY (home_id) REFERENCES homes (id),
  CONSTRAINT ck_bills_title_has_text CHECK (trim(title) <> ''),
  CONSTRAINT ck_bills_total_over_zero CHECK (typeof(total_cents) = 'integer' AND total_cents > 0),
  CONSTRAINT uq_bills_id_home UNIQUE (id, home_id)
);

CREATE INDEX idx_bills_home_created ON bills (home_id, created_at);

/*
  home_id is stored again in every share. The two foreign keys below use it to
  make sure that the bill and the member of a share belong to the same home.
*/
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  CONSTRAINT fk_shares_bill_in_home FOREIGN KEY (bill_id, home_id) REFERENCES bills (id, home_id),
  CONSTRAINT fk_shares_member_in_home FOREIGN KEY (member_id, home_id) REFERENCES members (id, home_id),
  CONSTRAINT uq_one_share_per_member_per_bill UNIQUE (bill_id, member_id),
  CONSTRAINT ck_shares_amount_whole_cents CHECK (typeof(amount_cents) = 'integer' AND amount_cents >= 0)
);

CREATE INDEX idx_shares_member ON shares (member_id);

/*
  A share is paid when it has a row here. share_id is the primary key, so a
  share can only ever get one row, even if two requests try to pay it together.
*/
CREATE TABLE payments (
  share_id TEXT PRIMARY KEY,
  pay_key TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  CONSTRAINT fk_payments_share FOREIGN KEY (share_id) REFERENCES shares (id),
  CONSTRAINT ck_payments_key_has_text CHECK (trim(pay_key) <> '')
);
