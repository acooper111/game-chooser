import { initializeDatabase, loadGamesFromCSV } from './database.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  try {
    console.log('Starting database migration...')
    
    // Initialize database schema
    await initializeDatabase()
    
    // Load games from CSV if it exists
    try {
      const csvPath = join(__dirname, 'games.csv')
      const csvData = readFileSync(csvPath, 'utf-8')
      const games = await loadGamesFromCSV(csvData, true) // Clear existing games first
      console.log(`Loaded ${games.length} games from CSV`)
    } catch (error) {
      console.log('No games.csv found, skipping game loading')
    }
    
    console.log('Migration completed successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
}

migrate()