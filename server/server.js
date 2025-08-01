import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import cors from 'cors'
import dotenv from 'dotenv'
import { v4 as uuidv4 } from 'uuid'

import { 
  initializeDatabase, 
  createSession, 
  getSession, 
  updateSessionGameState,
  addUserToSession,
  removeUserFromSession,
  getSessionUsers,
  updateUserLastSeen,
  deleteExpiredSessions,
  getSessionStats,
  getAllGames
} from './database.js'

import {
  initializeRedis,
  subscribeToSessionUpdates,
  publishSessionUpdate,
  cacheSessionState,
  getCachedSessionState,
  cacheSessionUsers,
  getCachedSessionUsers,
  setUserPresence,
  checkRateLimit
} from './redis.js'

dotenv.config()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

app.use(cors())
app.use(express.json())

// Store active WebSocket connections
const connections = new Map() // sessionId -> Map(userId -> ws)

// Generate 6-digit session ID
function generateSessionId() {
  let id
  do {
    id = Math.floor(100000 + Math.random() * 900000).toString()
  } while (connections.has(id)) // Ensure uniqueness in memory
  return id
}

// Initialize services
async function initializeServices() {
  try {
    await initializeDatabase()
    await initializeRedis()
    
    // Subscribe to Redis pub/sub for cross-instance communication
    subscribeToSessionUpdates(async (message) => {
      try {
        const update = JSON.parse(message)
        const { sessionId, updateType, data } = update
        
        // Skip updates from this server instance
        if (update.serverId === process.env.SERVER_ID) return
        
        // Broadcast to local WebSocket connections
        const sessionConnections = connections.get(sessionId)
        if (sessionConnections) {
          const broadcastData = JSON.stringify({
            type: updateType,
            ...data
          })
          
          sessionConnections.forEach((ws, userId) => {
            if (ws.readyState === 1) {
              ws.send(broadcastData)
            }
          })
        }
      } catch (error) {
        console.error('Error processing Redis message:', error)
      }
    })
    
    console.log('All services initialized successfully')
  } catch (error) {
    console.error('Failed to initialize services:', error)
    process.exit(1)
  }
}

// Helper functions
async function broadcastToSession(sessionId, message, excludeUserId = null) {
  const sessionConnections = connections.get(sessionId)
  if (!sessionConnections) return
  
  const data = JSON.stringify(message)
  sessionConnections.forEach((ws, userId) => {
    if (userId !== excludeUserId && ws.readyState === 1) {
      ws.send(data)
    }
  })
  
  // Also publish to Redis for other server instances
  await publishSessionUpdate(sessionId, message.type, message)
}

async function updateGameStateAndBroadcast(sessionId, gameState, excludeUserId = null) {
  try {
    // Update database
    await updateSessionGameState(sessionId, gameState)
    
    // Update cache
    await cacheSessionState(sessionId, gameState)
    
    // Broadcast to all users in session
    await broadcastToSession(sessionId, {
      type: 'game_state_update',
      gameState
    }, excludeUserId)
    
  } catch (error) {
    console.error('Error updating game state:', error)
  }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  let currentSessionId = null
  let currentUserId = null

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString())
      
      // Rate limiting
      const rateLimitKey = `rate_limit:${ws._socket.remoteAddress}:${Date.now()}`
      if (!(await checkRateLimit(rateLimitKey, 100, 60))) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Rate limit exceeded'
        }))
        return
      }
      
      switch (message.type) {
        case 'create_session':
          try {
            const sessionId = generateSessionId()
            await createSession(sessionId)
            
            ws.send(JSON.stringify({
              type: 'session_created',
              sessionId
            }))
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to create session'
            }))
          }
          break

        case 'join_session':
          try {
            const { sessionId, username } = message
            const userId = message.userId || uuidv4()
            
            // Check if session exists and is valid
            const session = await getSession(sessionId)
            if (!session) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Session not found or expired'
              }))
              return
            }

            // Add user to session
            await addUserToSession(sessionId, userId, username)
            
            // Track connection
            if (!connections.has(sessionId)) {
              connections.set(sessionId, new Map())
            }
            connections.get(sessionId).set(userId, ws)
            
            currentSessionId = sessionId
            currentUserId = userId
            
            // Set user presence
            await setUserPresence(sessionId, userId)
            
            // Get current game state and users
            const gameState = await getCachedSessionState(sessionId) || session.game_state
            const users = await getSessionUsers(sessionId)
            
            // Cache users
            await cacheSessionUsers(sessionId, users)
            
            ws.send(JSON.stringify({
              type: 'session_joined',
              sessionId,
              userId,
              gameState,
              users
            }))
            
            // Notify other users
            await broadcastToSession(sessionId, {
              type: 'user_joined',
              userId,
              username,
              users
            }, userId)
            
          } catch (error) {
            console.error('Error joining session:', error)
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to join session'
            }))
          }
          break

        case 'game_action':
          if (!currentSessionId) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Not in a session'
            }))
            return
          }
          
          try {
            const { action, data } = message
            
            // Get current game state
            const session = await getSession(currentSessionId)
            if (!session) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Session not found'
              }))
              return
            }
            
            let gameState = await getCachedSessionState(currentSessionId) || session.game_state
            
            // Ensure userGameCounts exists
            if (!gameState.userGameCounts) {
              gameState.userGameCounts = {}
            }
            
            switch (action) {
              case 'add_game':
                if (!gameState.selectedGames.find(g => g.name === data.game.name)) {
                  // Check game limit
                  const currentUserCount = gameState.userGameCounts[currentUserId] || 0
                  if (gameState.gameLimit && currentUserCount >= gameState.gameLimit) {
                    ws.send(JSON.stringify({
                      type: 'error',
                      message: `You can only submit ${gameState.gameLimit} game${gameState.gameLimit === 1 ? '' : 's'}.`
                    }))
                    break
                  }
                  
                  // Add the game with user attribution
                  const gameWithUser = { ...data.game, addedBy: currentUserId }
                  gameState.selectedGames.push(gameWithUser)
                  
                  // Update user game count
                  gameState.userGameCounts[currentUserId] = (gameState.userGameCounts[currentUserId] || 0) + 1
                  
                  await updateGameStateAndBroadcast(currentSessionId, gameState) // Don't exclude the user
                }
                break
                
              case 'remove_game':
                const gameToRemove = gameState.selectedGames.find(game => game.name === data.gameName)
                if (gameToRemove && gameToRemove.addedBy) {
                  // Decrement the user's game count
                  if (gameState.userGameCounts[gameToRemove.addedBy] > 0) {
                    gameState.userGameCounts[gameToRemove.addedBy]--
                  }
                }
                
                gameState.selectedGames = gameState.selectedGames
                  .filter(game => game.name !== data.gameName)
                await updateGameStateAndBroadcast(currentSessionId, gameState) // Don't exclude the user
                break
                
              case 'clear_all_games':
                gameState.selectedGames = []
                gameState.winner = null
                gameState.isSpinning = false
                gameState.spinData = null
                gameState.userGameCounts = {} // Reset all user game counts
                await updateGameStateAndBroadcast(currentSessionId, gameState)
                break
                
              case 'start_spin':
                // Prevent multiple simultaneous spins
                if (gameState.isSpinning) {
                  break
                }
                
                gameState.isSpinning = true
                gameState.winner = null
                
                // Generate synchronized spin parameters
                const spinDuration = 3000 + Math.random() * 2000 // 3-5 seconds
                const startTime = Date.now()
                // Sort games alphabetically to ensure same order as client
                const games = [...gameState.selectedGames].sort((a, b) => a.name.localeCompare(b.name))
                
                let preCalculatedWinner = null
                let finalRotation = 0
                let baseRotation = 0
                
                if (games.length > 0) {
                  // Randomly select a winner
                  const winningIndex = Math.floor(Math.random() * games.length)
                  preCalculatedWinner = games[winningIndex]
                  
                  // Calculate rotation to position winner at top (12 o'clock = -π/2)
                  const anglePerSection = (2 * Math.PI) / games.length
                  
                  // The client draws: startAngle = winningIndex * anglePerSection + finalRotation
                  // We want the middle of the winner section to be at -π/2
                  // Middle of section = startAngle + anglePerSection/2 = winningIndex * anglePerSection + finalRotation + anglePerSection/2
                  // Set this equal to -π/2: winningIndex * anglePerSection + finalRotation + anglePerSection/2 = -π/2
                  // Solve for finalRotation: finalRotation = -π/2 - winningIndex * anglePerSection - anglePerSection/2
                  baseRotation = -Math.PI / 2 - winningIndex * anglePerSection - anglePerSection / 2
                  
                  // Add multiple full rotations for spinning effect
                  const numExtraRotations = Math.floor(10 + Math.random() * 5) // Use integer rotations
                  const extraRotations = numExtraRotations * 2 * Math.PI
                  finalRotation = baseRotation + extraRotations
                  
                  
                  // Verify the reverse calculation
                  const reverseNumerator = -Math.PI / 2 - anglePerSection / 2 - baseRotation
                  let reverseRawIndex = reverseNumerator / anglePerSection
                  while (reverseRawIndex < 0) {
                    reverseRawIndex += games.length
                  }
                  const reverseIndex = Math.round(reverseRawIndex) % games.length
                  
                }
                
                gameState.spinData = {
                  startTime,
                  duration: spinDuration,
                  finalRotation,
                  baseRotation,
                  preCalculatedWinner
                }
                
                
                await updateGameStateAndBroadcast(currentSessionId, gameState) // Don't exclude anyone for spin data
                
                // Auto-complete the spin after duration
                setTimeout(async () => {
                  try {
                    const currentSession = await getSession(currentSessionId)
                    if (currentSession) {
                      let currentGameState = await getCachedSessionState(currentSessionId) || currentSession.game_state
                      
                      if (currentGameState.isSpinning && currentGameState.spinData) {
                        // Use pre-calculated winner
                        const winner = currentGameState.spinData.preCalculatedWinner
                        
                        currentGameState.isSpinning = false
                        currentGameState.winner = winner
                        currentGameState.spinData = null
                        
                        await updateGameStateAndBroadcast(currentSessionId, currentGameState)
                      }
                    }
                  } catch (error) {
                    console.error('Error completing spin:', error)
                  }
                }, spinDuration)
                break
            }
            
            // Update user last seen
            await updateUserLastSeen(currentSessionId, currentUserId)
            await setUserPresence(currentSessionId, currentUserId)
            
          } catch (error) {
            console.error('Error processing game action:', error)
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to process action'
            }))
          }
          break

        case 'kick_user':
          try {
            const { userId: userToKick } = message
            
            // Check if current user is the session creator (first user)
            const sessionUsers = await getSessionUsers(currentSessionId)
            const isCreator = sessionUsers.length > 0 && sessionUsers[0].user_id === currentUserId
            
            if (isCreator && userToKick !== currentUserId) {
              // Find the WebSocket connection for the user to kick
              const sessionConnections = connections.get(currentSessionId)
              if (sessionConnections && sessionConnections.has(userToKick)) {
                const userWs = sessionConnections.get(userToKick)
                
                // Send kick message to the user
                userWs.send(JSON.stringify({
                  type: 'kicked',
                  message: 'You have been removed from the session'
                }))
                
                // Close their connection
                userWs.close()
              }
            }
          } catch (error) {
            console.error('Error kicking user:', error)
          }
          break

        case 'set_game_limit':
          try {
            const { limit } = message
            
            // Check if current user is the session creator (first user)
            const sessionUsers = await getSessionUsers(currentSessionId)
            const isCreator = sessionUsers.length > 0 && sessionUsers[0].user_id === currentUserId
            
            if (isCreator) {
              const session = await getSession(currentSessionId)
              if (session) {
                let gameState = await getCachedSessionState(currentSessionId) || session.game_state
                gameState.gameLimit = limit
                await updateGameStateAndBroadcast(currentSessionId, gameState)
              }
            }
          } catch (error) {
            console.error('Error setting game limit:', error)
          }
          break

        case 'heartbeat':
          if (currentSessionId && currentUserId) {
            await setUserPresence(currentSessionId, currentUserId)
            await updateUserLastSeen(currentSessionId, currentUserId)
          }
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
          break
      }
    } catch (error) {
      console.error('Error processing message:', error)
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }))
    }
  })

  ws.on('close', async () => {
    if (currentSessionId && currentUserId) {
      try {
        // Remove from connections
        const sessionConnections = connections.get(currentSessionId)
        if (sessionConnections) {
          sessionConnections.delete(currentUserId)
          if (sessionConnections.size === 0) {
            connections.delete(currentSessionId)
          }
        }
        
        // Remove from database
        await removeUserFromSession(currentSessionId, currentUserId)
        
        // Get updated user list and notify others
        const users = await getSessionUsers(currentSessionId)
        await cacheSessionUsers(currentSessionId, users)
        
        await broadcastToSession(currentSessionId, {
          type: 'user_left',
          userId: currentUserId,
          users
        })
        
      } catch (error) {
        console.error('Error handling connection close:', error)
      }
    }
  })

  ws.on('error', (error) => {
    console.error('WebSocket error:', error)
  })
})

// REST API endpoints
app.get('/api/session/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id)
    if (session) {
      const users = await getSessionUsers(req.params.id)
      res.json({
        id: session.id,
        userCount: users.length,
        gameState: session.game_state,
        users,
        createdAt: session.created_at,
        updatedAt: session.updated_at
      })
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  } catch (error) {
    console.error('Error getting session:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/sessions/stats', async (req, res) => {
  try {
    const stats = await getSessionStats()
    res.json(stats)
  } catch (error) {
    console.error('Error getting session stats:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/games', async (req, res) => {
  try {
    const games = await getAllGames()
    res.json(games)
  } catch (error) {
    console.error('Error getting games:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    serverId: process.env.SERVER_ID || 'default'
  })
})

// Cleanup tasks
const CLEANUP_INTERVAL = parseInt(process.env.SESSION_CLEANUP_INTERVAL) || 3600000 // 1 hour

setInterval(async () => {
  try {
    const deletedCount = await deleteExpiredSessions()
  } catch (error) {
    console.error('Error during cleanup:', error)
  }
}, CLEANUP_INTERVAL)

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  server.close(() => {
    process.exit(0)
  })
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...')
  server.close(() => {
    process.exit(0)
  })
})

// Start server
const PORT = process.env.PORT || 3001

initializeServices().then(() => {
  server.listen(PORT, () => {
    console.log(`Game Chooser server running on port ${PORT}`)
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log(`Server ID: ${process.env.SERVER_ID || 'default'}`)
  })
}).catch(error => {
  console.error('Failed to start server:', error)
  process.exit(1)
})