import { createClient } from 'redis'
import dotenv from 'dotenv'

dotenv.config()

const client = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
})

const subscriber = client.duplicate()
const publisher = client.duplicate()

export const initializeRedis = async () => {
  try {
    await client.connect()
    await subscriber.connect()
    await publisher.connect()
    
    console.log('Redis clients connected successfully')
  } catch (error) {
    console.error('Error connecting to Redis:', error)
    throw error
  }
}

// Pub/Sub for real-time updates across server instances
export const subscribeToSessionUpdates = (callback) => {
  subscriber.subscribe('session_updates', callback)
}

export const publishSessionUpdate = async (sessionId, updateType, data) => {
  const message = JSON.stringify({
    sessionId,
    updateType,
    data,
    timestamp: Date.now(),
    serverId: process.env.SERVER_ID || 'default'
  })
  
  await publisher.publish('session_updates', message)
}

// Cache frequently accessed data
export const cacheSessionState = async (sessionId, gameState, ttl = 300) => {
  await client.setEx(`session:${sessionId}:state`, ttl, JSON.stringify(gameState))
}

export const getCachedSessionState = async (sessionId) => {
  const cached = await client.get(`session:${sessionId}:state`)
  return cached ? JSON.parse(cached) : null
}

export const cacheSessionUsers = async (sessionId, users, ttl = 60) => {
  await client.setEx(`session:${sessionId}:users`, ttl, JSON.stringify(users))
}

export const getCachedSessionUsers = async (sessionId) => {
  const cached = await client.get(`session:${sessionId}:users`)
  return cached ? JSON.parse(cached) : null
}

// Rate limiting
export const checkRateLimit = async (key, limit, window) => {
  const current = await client.incr(key)
  if (current === 1) {
    await client.expire(key, window)
  }
  return current <= limit
}

// Session presence tracking
export const setUserPresence = async (sessionId, userId, ttl = 30) => {
  await client.setEx(`presence:${sessionId}:${userId}`, ttl, Date.now().toString())
}

export const getUserPresence = async (sessionId, userId) => {
  const presence = await client.get(`presence:${sessionId}:${userId}`)
  return presence ? parseInt(presence) : null
}

export const getSessionPresence = async (sessionId) => {
  const keys = await client.keys(`presence:${sessionId}:*`)
  const presence = {}
  
  for (const key of keys) {
    const userId = key.split(':')[2]
    const timestamp = await client.get(key)
    if (timestamp) {
      presence[userId] = parseInt(timestamp)
    }
  }
  
  return presence
}

// Cleanup
export const cleanup = async () => {
  await client.quit()
  await subscriber.quit()
  await publisher.quit()
}

export { client, subscriber, publisher }