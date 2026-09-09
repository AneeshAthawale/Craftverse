-- ============================================================================
-- CraftVerse initial schema (PostgreSQL)
-- Mirrors client/plan.md §4–§16.
-- Run via `npm run db:migrate` (idempotent: CREATE ... IF NOT EXISTS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- teams
-- team_id is the permanent identifier (e.g. 'T01'). Teams created through the
-- public registration flow auto-assign the next 'T##' from teams_team_id_seq;
-- organizer-created teams may still supply their own id.
-- registration_token is a secure random token used for the single-use
-- Registration QR (team-level verification; sent to the team leader).
-- Status lifecycle: UNREGISTERED (invited/legacy) -> SUBMITTED (public form
-- submitted) -> REGISTERED (checked in on event day via admin QR scan).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS teams_team_id_seq START 1;
CREATE TABLE IF NOT EXISTS teams (
  team_id              TEXT PRIMARY KEY
                       DEFAULT ('T' || lpad(nextval('teams_team_id_seq')::text, 2, '0')),
  team_name            TEXT NOT NULL,
  registration_token   TEXT NOT NULL UNIQUE,
  registration_status  TEXT NOT NULL DEFAULT 'UNREGISTERED'
                       CHECK (registration_status IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED')),
  registered_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- participants
-- A participant belongs to exactly one team. The team leader is one of the
-- team's participants (is_leader = true, at most one per team enforced by
-- idx_participants_one_leader_per_team).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participants (
  participant_id  BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  team_id         TEXT NOT NULL REFERENCES teams(team_id),
  is_leader       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users (authentication + authorization)
-- role hierarchy: DEV > ADMIN > PARTICIPANT.
-- There is no TEAM login role: teams are a database/domain entity represented
-- through the participants linked to them.
-- participant_id / team_id link a user to their participant/team record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_id         BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('DEV', 'ADMIN', 'PARTICIPANT')),
  participant_id  BIGINT REFERENCES participants(participant_id),
  team_id         TEXT REFERENCES teams(team_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- registration
-- One registration record per team; keeps the QR token and mirrors
-- teams.registration_status (SUBMITTED once the public form is submitted,
-- REGISTERED once the team is checked in on event day).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration (
  registration_id  BIGSERIAL PRIMARY KEY,
  team_id          TEXT NOT NULL UNIQUE REFERENCES teams(team_id),
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'UNREGISTERED'
                   CHECK (status IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED')),
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- games
-- Data-driven games. Adding a game = inserting a row, no code rewrite.
-- route maps to a frontend route segment (e.g. 'rlgl' -> /games/rlgl).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  game_id     BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  rules       TEXT,
  status      TEXT NOT NULL DEFAULT 'UPCOMING'
              CHECK (status IN ('UPCOMING', 'LIVE', 'PAUSED', 'COMPLETED', 'LOCKED')),
  route       TEXT UNIQUE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  config      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- game_results
-- Reusable across games (plan.md §16). Rows are never deleted so history
-- remains available for leaderboards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_results (
  result_id    BIGSERIAL PRIMARY KEY,
  game_id      BIGINT NOT NULL REFERENCES games(game_id),
  team_id      TEXT NOT NULL REFERENCES teams(team_id),
  rank         INT,
  score        NUMERIC,
  time_seconds NUMERIC,
  status       TEXT NOT NULL DEFAULT 'PLAYING'
               CHECK (status IN ('PLAYING', 'QUALIFIED', 'DISQUALIFIED', 'WINNER')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, team_id)
);

-- ---------------------------------------------------------------------------
-- food_access
-- Individual per-participant, per-meal token. A new token per food break.
-- Food QR is different from Registration QR.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_access (
  food_access_id BIGSERIAL PRIMARY KEY,
  participant_id BIGINT NOT NULL REFERENCES participants(participant_id),
  meal_type      TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS')),
  event_day      INT NOT NULL CHECK (event_day IN (1, 2)),
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'UNUSED'
                 CHECK (status IN ('UNUSED', 'USED', 'EXPIRED')),
  used_at        TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, meal_type, event_day)
);

-- ---------------------------------------------------------------------------
-- notifications
-- Stored in PostgreSQL and delivered in real time via Socket.IO.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  notification_id BIGSERIAL PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'NORMAL'
                  CHECK (type IN ('NORMAL', 'IMPORTANT', 'GAME', 'EMERGENCY')),
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- inquiries
-- Participant support/inquiry system.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inquiries (
  inquiry_id     BIGSERIAL PRIMARY KEY,
  participant_id BIGINT REFERENCES participants(participant_id),
  team_id        TEXT REFERENCES teams(team_id),
  title          TEXT NOT NULL,
  message        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'OPEN'
                 CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
  response       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- event_status
-- Singleton row (id = 1) holding the authoritative hackathon-wide event status.
-- Source of truth for the event lifecycle: NOT_STARTED → LIVE ⇄ BREAK → ENDED.
-- Distinct from games.status — a game can be LIVE while the event is BREAK, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_status (
  id           SMALLINT PRIMARY KEY CHECK (id = 1),
  status       TEXT NOT NULL DEFAULT 'NOT_STARTED'
               CHECK (status IN ('NOT_STARTED', 'LIVE', 'BREAK', 'ENDED')),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   BIGINT REFERENCES users(user_id)
);

-- Seed the singleton row (idempotent).
INSERT INTO event_status (id, status)
VALUES (1, 'NOT_STARTED')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Indexes for the most common lookups.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_participants_team ON participants(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_email ON participants(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_one_leader_per_team ON participants(team_id) WHERE is_leader;
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_team_name ON teams(team_name);
CREATE INDEX IF NOT EXISTS idx_teams_registration_token ON teams(registration_token);
CREATE INDEX IF NOT EXISTS idx_food_access_token ON food_access(token);
CREATE INDEX IF NOT EXISTS idx_food_access_participant ON food_access(participant_id);
CREATE INDEX IF NOT EXISTS idx_game_results_game ON game_results(game_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);

-- ---------------------------------------------------------------------------
-- Idempotent additive migrations for existing dev databases.
-- Each block must be safe to run on a fresh DB as well (it re-asserts what the
-- CREATE TABLE blocks above already did), so `npm run db:migrate` works for
-- both fresh installs and existing databases.
-- ---------------------------------------------------------------------------
ALTER TABLE food_access ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- teams_team_id_seq: create if the table predates the sequence, sync it past
-- any existing 'T##' ids (explicit-id inserts never advance a sequence), and
-- default new team_id values to the next 'T##'.
CREATE SEQUENCE IF NOT EXISTS teams_team_id_seq START 1;
ALTER TABLE teams ALTER COLUMN team_id
  SET DEFAULT ('T' || lpad(nextval('teams_team_id_seq')::text, 2, '0'));
SELECT setval('teams_team_id_seq',
  COALESCE((SELECT max(substring(team_id from '^T([0-9]+)$')::int)
            FROM teams WHERE team_id ~ '^T[0-9]+$'), 0) + 1, false);

-- participants.is_leader + uniqueness guards (public registration phase).
ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_leader BOOLEAN NOT NULL DEFAULT false;
-- Drop + recreate so a DB that already has non-unique (mis-named) versions of
-- these indexes converges on the unique ones even though CREATE ... IF NOT
-- EXISTS would skip them.
DROP INDEX IF EXISTS idx_participants_one_leader_per_team;
CREATE UNIQUE INDEX idx_participants_one_leader_per_team
  ON participants(team_id) WHERE is_leader;
DROP INDEX IF EXISTS idx_participants_email;
CREATE UNIQUE INDEX idx_participants_email
  ON participants(email) WHERE email IS NOT NULL;
DROP INDEX IF EXISTS idx_teams_team_name;
CREATE UNIQUE INDEX idx_teams_team_name ON teams(team_name);

-- teams.registration_status: widen the CHECK to include SUBMITTED. Normalize
-- any legacy/experimental status values (e.g. a stray 'VERIFIED' from an older
-- attempt) to the terminal REGISTERED state before re-asserting the CHECK.
UPDATE teams SET registration_status = 'REGISTERED', registered_at = COALESCE(registered_at, now())
 WHERE registration_status NOT IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED');
UPDATE registration SET status = 'REGISTERED', verified_at = COALESCE(verified_at, now())
 WHERE status NOT IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED');
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_registration_status_check;
ALTER TABLE teams ADD CONSTRAINT teams_registration_status_check
  CHECK (registration_status IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED'));

-- registration.status: widen the CHECK to include SUBMITTED.
ALTER TABLE registration DROP CONSTRAINT IF EXISTS registration_status_check;
ALTER TABLE registration ADD CONSTRAINT registration_status_check
  CHECK (status IN ('UNREGISTERED', 'REGISTERED', 'SUBMITTED'));

-- users.role: remove the obsolete TEAM login role (constraint name is
-- deterministic for inline CHECKs, so DROP + ADD keeps existing DBs in sync).
DELETE FROM users WHERE role = 'TEAM';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('DEV', 'ADMIN', 'PARTICIPANT'));
