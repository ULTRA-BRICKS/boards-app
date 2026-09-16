-- Additive account-service schema. Not applied automatically on application startup.
-- A separate least-privilege server role is required; anonymous API roles receive no grants.
CREATE SCHEMA IF NOT EXISTS boards_accounts;
CREATE TABLE IF NOT EXISTS boards_accounts.users(id text PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,avatar text NOT NULL DEFAULT '',verified boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS boards_accounts.spaces(id text PRIMARY KEY,name text NOT NULL,version integer NOT NULL DEFAULT 1,document jsonb NOT NULL,allowed_domains text[] NOT NULL,time_zone text NOT NULL DEFAULT 'UTC',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS boards_accounts.members(space_id text REFERENCES boards_accounts.spaces(id),account_id text REFERENCES boards_accounts.users(id),person_id text NOT NULL,role text NOT NULL CHECK(role IN ('owner','admin','member','viewer')),assignment_mail boolean NOT NULL DEFAULT true,weekly_mail boolean NOT NULL DEFAULT true,PRIMARY KEY(space_id,account_id),UNIQUE(space_id,person_id));
CREATE TABLE IF NOT EXISTS boards_accounts.sessions(hash text PRIMARY KEY,account_id text NOT NULL REFERENCES boards_accounts.users(id),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS boards_accounts.history(id bigserial PRIMARY KEY,space_id text NOT NULL REFERENCES boards_accounts.spaces(id),board_id text NOT NULL,item_id text NOT NULL,actor_id text NOT NULL REFERENCES boards_accounts.users(id),actor_name text NOT NULL,kind text NOT NULL,changes jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS history_item_page ON boards_accounts.history(space_id,board_id,item_id,id DESC);
CREATE TABLE IF NOT EXISTS boards_accounts.batches(id text PRIMARY KEY,space_id text NOT NULL REFERENCES boards_accounts.spaces(id),recipient_id text NOT NULL REFERENCES boards_accounts.users(id),kind text NOT NULL CHECK(kind IN ('assignment','weekly')),events jsonb NOT NULL,due_at timestamptz NOT NULL,state text NOT NULL CHECK(state IN ('pending','sending','sent','cancelled','held')) DEFAULT 'pending',lease_until timestamptz,lease_token text,payload jsonb,attempts integer NOT NULL DEFAULT 0,first_attempt_at timestamptz,provider_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS notification_due ON boards_accounts.batches(state,due_at);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_dedup ON boards_accounts.batches(space_id,recipient_id,(events->>'period')) WHERE kind='weekly';
CREATE TABLE IF NOT EXISTS boards_accounts.invites(space_id text REFERENCES boards_accounts.spaces(id),email text NOT NULL,name text NOT NULL,person_id text NOT NULL,role text NOT NULL CHECK(role IN ('member','viewer')),invited_by text REFERENCES boards_accounts.users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(space_id,email));
CREATE TABLE IF NOT EXISTS boards_accounts.integrations(space_id text PRIMARY KEY REFERENCES boards_accounts.spaces(id),slack_team_id text UNIQUE,slack_team_name text,slack_token_ciphertext text,connected_by text REFERENCES boards_accounts.users(id),connected_at timestamptz,last_synced_at timestamptz);
CREATE TABLE IF NOT EXISTS boards_accounts.oauth_states(hash text PRIMARY KEY,space_id text REFERENCES boards_accounts.spaces(id),account_id text REFERENCES boards_accounts.users(id),expires_at timestamptz NOT NULL,consumed_at timestamptz);
CREATE TABLE IF NOT EXISTS boards_accounts.event_receipts(event_id text PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now(),payload jsonb,state text NOT NULL DEFAULT 'pending',lease_until timestamptz);
REVOKE ALL ON SCHEMA boards_accounts FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA boards_accounts FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA boards_accounts FROM PUBLIC;
CREATE TABLE IF NOT EXISTS boards_accounts.email_challenges(id text PRIMARY KEY,email text NOT NULL,proof text NOT NULL,attempts integer NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL,consumed_at timestamptz);
CREATE INDEX IF NOT EXISTS challenge_email ON boards_accounts.email_challenges(email,expires_at);
CREATE TABLE IF NOT EXISTS boards_accounts.rate_limits(key text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA boards_accounts FROM PUBLIC;

CREATE INDEX IF NOT EXISTS batches_open_space ON boards_accounts.batches(space_id) WHERE state='pending' AND payload IS NULL;

ALTER TABLE boards_accounts.event_receipts ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE boards_accounts.event_receipts ADD COLUMN IF NOT EXISTS lease_token text;
