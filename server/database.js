import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'gamechooser',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// Database schema setup
export const initializeDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(6) PRIMARY KEY,
        game_state JSONB NOT NULL DEFAULT '{"selectedGames": [], "isSpinning": false, "winner": null}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_users (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(6) REFERENCES sessions(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(session_id, user_id)
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        genre VARCHAR(100),
        platform VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_session_users_session_id ON session_users(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_users_last_seen ON session_users(last_seen);
    `)

    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Error initializing database:', error)
    throw error
  }
}

// Session operations
export const createSession = async (sessionId) => {
  const result = await pool.query(
    'INSERT INTO sessions (id) VALUES ($1) RETURNING *',
    [sessionId]
  )
  return result.rows[0]
}

export const getSession = async (sessionId) => {
  const result = await pool.query(
    'SELECT * FROM sessions WHERE id = $1 AND expires_at > NOW()',
    [sessionId]
  )
  return result.rows[0]
}

export const updateSessionGameState = async (sessionId, gameState) => {
  const result = await pool.query(
    'UPDATE sessions SET game_state = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [sessionId, JSON.stringify(gameState)]
  )
  return result.rows[0]
}

export const deleteExpiredSessions = async () => {
  const result = await pool.query(
    'DELETE FROM sessions WHERE expires_at <= NOW()'
  )
  return result.rowCount
}

// User operations
export const addUserToSession = async (sessionId, userId, username) => {
  const result = await pool.query(`
    INSERT INTO session_users (session_id, user_id, username)
    VALUES ($1, $2, $3)
    ON CONFLICT (session_id, user_id)
    DO UPDATE SET last_seen = NOW(), username = $3
    RETURNING *
  `, [sessionId, userId, username])
  return result.rows[0]
}

export const removeUserFromSession = async (sessionId, userId) => {
  const result = await pool.query(
    'DELETE FROM session_users WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId]
  )
  return result.rowCount > 0
}

export const getSessionUsers = async (sessionId) => {
  const result = await pool.query(
    'SELECT user_id, username, joined_at, last_seen FROM session_users WHERE session_id = $1 ORDER BY joined_at',
    [sessionId]
  )
  return result.rows
}

export const updateUserLastSeen = async (sessionId, userId) => {
  const result = await pool.query(
    'UPDATE session_users SET last_seen = NOW() WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId]
  )
  return result.rowCount > 0
}

// Game operations
export const clearAllGames = async () => {
  const result = await pool.query('DELETE FROM games')
  return result.rowCount
}

export const loadGamesFromCSV = async (csvData, clearExisting = false) => {
  if (clearExisting) {
    await clearAllGames()
  }

  const lines = csvData.split('\n')
  const games = lines.slice(1).map(line => {
    const [name, genre, platform] = line.split(',')
    return { 
      name: name?.trim(), 
      genre: genre?.trim(), 
      platform: platform?.trim() 
    }
  }).filter(game => game.name)

  // Insert games
  for (const game of games) {
    await pool.query(`
      INSERT INTO games (name, genre, platform)
      VALUES ($1, $2, $3)
    `, [game.name, game.genre, game.platform])
  }

  return games
}

export const getAllGames = async () => {
  const result = await pool.query(
    'SELECT name, genre, platform FROM games ORDER BY name'
  )
  return result.rows
}

// Statistics
export const getSessionStats = async () => {
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total_sessions,
      COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as active_sessions,
      AVG(
        (SELECT COUNT(*) FROM session_users su WHERE su.session_id = s.id)
      ) as avg_users_per_session
    FROM sessions s
  `)
  return result.rows[0]
}

export default pool