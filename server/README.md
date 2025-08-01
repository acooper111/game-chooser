# Game Chooser Server

A scalable multiplayer backend for the Game Chooser application with database persistence and horizontal scaling support.

## Features

- **6-digit session IDs** for easy sharing
- **PostgreSQL** for persistent data storage
- **Redis** for real-time pub/sub between server instances
- **WebSocket** real-time communication
- **Horizontal scaling** support with load balancing
- **Session expiration** and cleanup
- **Rate limiting** and security measures
- **Health checks** and monitoring

## Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Frontend      │
│   Instance 1    │    │   Instance 2    │
└─────────┬───────┘    └─────────┬───────┘
          │ WebSocket            │ WebSocket
          │                      │
┌─────────▼───────┐    ┌─────────▼───────┐
│   Server        │    │   Server        │
│   Instance 1    │◄──►│   Instance 2    │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          │       Redis          │
          └──────────┬───────────┘
                     │ Pub/Sub
          ┌──────────▼───────────┐
          │     PostgreSQL       │
          │   (Shared Database)  │
          └──────────────────────┘
```

## Quick Start

### Using Docker Compose (Recommended)

1. **Start all services:**
   ```bash
   docker-compose up -d
   ```

2. **Run migrations:**
   ```bash
   docker-compose exec app npm run migrate
   ```

3. **Access the application:**
   - Server 1: http://localhost:3001
   - Server 2: http://localhost:3002
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

### Manual Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database and Redis credentials
   ```

3. **Start PostgreSQL and Redis:**
   ```bash
   # Using Docker
   docker run -d --name postgres -p 5432:5432 -e POSTGRES_DB=gamechooser -e POSTGRES_PASSWORD=password postgres:15
   docker run -d --name redis -p 6379:6379 redis:7-alpine
   ```

4. **Run migrations:**
   ```bash
   npm run migrate
   ```

5. **Start the server:**
   ```bash
   npm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost/gamechooser` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `SERVER_ID` | Unique server identifier | `default` |
| `SESSION_CLEANUP_INTERVAL` | Cleanup interval (ms) | `3600000` |
| `SESSION_MAX_AGE` | Session expiration (ms) | `86400000` |

## API Endpoints

### REST API

- `GET /api/health` - Health check
- `GET /api/session/:id` - Get session info
- `GET /api/sessions/stats` - Get session statistics
- `GET /api/games` - Get all games

### WebSocket API

#### Client → Server Messages

```javascript
// Create a new session
{
  "type": "create_session"
}

// Join an existing session
{
  "type": "join_session",
  "sessionId": "123456",
  "username": "Player1",
  "userId": "optional-user-id"
}

// Game actions
{
  "type": "game_action",
  "action": "add_game|remove_game|start_spin|spin_complete",
  "data": { /* action-specific data */ }
}

// Heartbeat
{
  "type": "heartbeat"
}
```

#### Server → Client Messages

```javascript
// Session created
{
  "type": "session_created",
  "sessionId": "123456"
}

// Joined session successfully
{
  "type": "session_joined",
  "sessionId": "123456",
  "userId": "user-id",
  "gameState": { /* current game state */ },
  "users": [ /* list of users */ ]
}

// Game state updated
{
  "type": "game_state_update",
  "gameState": {
    "selectedGames": [],
    "isSpinning": false,
    "winner": null
  }
}

// User joined/left
{
  "type": "user_joined|user_left",
  "userId": "user-id",
  "username": "Player1",
  "users": [ /* updated user list */ ]
}

// Error
{
  "type": "error",
  "message": "Error description"
}
```

## Database Schema

### Sessions Table
- `id` (VARCHAR(6)): 6-digit session ID
- `game_state` (JSONB): Current game state
- `created_at`, `updated_at`, `expires_at` (TIMESTAMP)

### Session Users Table
- `session_id`: Reference to session
- `user_id`, `username`: User information
- `joined_at`, `last_seen` (TIMESTAMP)

### Games Table
- `id` (SERIAL): Primary key
- `name`, `genre`, `platform`: Game information

## Scaling

The server supports horizontal scaling through:

1. **Stateless design**: All state stored in database/Redis
2. **Redis pub/sub**: Real-time updates across instances
3. **Load balancing**: Multiple server instances behind a load balancer
4. **Session affinity**: Not required due to shared state

### Load Balancer Configuration

Use sticky sessions or round-robin with any load balancer:

```nginx
upstream gamechooser {
    server localhost:3001;
    server localhost:3002;
}

server {
    listen 80;
    location / {
        proxy_pass http://gamechooser;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Monitoring

- Health check endpoint: `/api/health`
- Session statistics: `/api/sessions/stats`
- Redis monitoring: Use Redis CLI or monitoring tools
- PostgreSQL monitoring: Use standard PostgreSQL monitoring tools

## Security Features

- Rate limiting per IP
- Input validation
- Session expiration
- WebSocket connection limits
- CORS protection

## Development

```bash
# Start in development mode with auto-reload
npm run dev

# Run migrations
npm run migrate

# Run with different server ID for testing scaling
SERVER_ID=test npm run dev
```

## Production Deployment

1. Use environment variables for configuration
2. Set up proper logging and monitoring
3. Configure load balancer with health checks
4. Set up database backups
5. Monitor Redis memory usage
6. Use process managers like PM2 for reliability