-- SQL Migration for Discord-Style Architecture
-- To be run in Supabase SQL Editor

-- 1. Users Table (for persistent accounts)
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT auth.uid(),
  email        TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  google_sub   TEXT UNIQUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Servers Table
CREATE TABLE IF NOT EXISTS servers (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  icon_url    TEXT,
  owner_id    UUID REFERENCES users(id),
  invite_code TEXT UNIQUE DEFAULT substring(gen_random_uuid()::text, 1, 8),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Server Members Table (for many-to-many relationship)
CREATE TABLE IF NOT EXISTS server_members (
  server_id   TEXT REFERENCES servers(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT DEFAULT 'member', -- 'owner', 'admin', 'member'
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (server_id, user_id)
);

-- 4. Channels Table (Replaces 'rooms' concept)
CREATE TABLE IF NOT EXISTS channels (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  server_id    TEXT REFERENCES servers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT DEFAULT 'pdf', -- 'text', 'pdf'
  position     INT DEFAULT 0,
  
  -- PDF State (persisted)
  pdf_drive_id  TEXT,
  pdf_name      TEXT,
  pdf_url       TEXT,
  
  -- Reading state (synced)
  current_page  INT DEFAULT 1,
  scroll_pct    FLOAT DEFAULT 0.0,
  zoom          FLOAT DEFAULT 1.0,
  
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RLS (Row Level Security) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

-- Basic Policies (can be refined later)
CREATE POLICY "Users can see their own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON users FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Members can see their servers" ON servers 
FOR SELECT USING (
  EXISTS (SELECT 1 FROM server_members WHERE server_id = servers.id AND user_id = auth.uid())
);

CREATE POLICY "Members can see channels in their servers" ON channels
FOR SELECT USING (
  EXISTS (SELECT 1 FROM server_members WHERE server_id = channels.server_id AND user_id = auth.uid())
);

-- 6. Triggers for updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_servers_timestamp BEFORE UPDATE ON servers FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_channels_timestamp BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_timestamp();
