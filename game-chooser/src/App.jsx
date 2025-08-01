import { useState, useEffect, useRef } from 'react'
import './App.css'
import GameAutocomplete from './components/GameAutocomplete'
import SpinningWheel from './components/SpinningWheel'

function App() {
  const [games, setGames] = useState([])
  const [selectedGames, setSelectedGames] = useState([])
  const [isSpinning, setIsSpinning] = useState(false)
  const [winner, setWinner] = useState(null)
  const [spinData, setSpinData] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [userId, setUserId] = useState(null)
  const [username, setUsername] = useState('')
  const [users, setUsers] = useState([])
  const [connected, setConnected] = useState(false)
  const [showSessionInput, setShowSessionInput] = useState(true)
  const [isSessionCreator, setIsSessionCreator] = useState(false)
  const [gameLimit, setGameLimit] = useState(null) // null means no limit
  const [userGameCounts, setUserGameCounts] = useState({})
  const wsRef = useRef(null)

  useEffect(() => {
    fetch('/api/games')
      .then(response => response.json())
      .then(gameList => {
        setGames(gameList)
      })
      .catch(error => {})
  }, [])

  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:3001')
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)

      switch (message.type) {
        case 'session_created':
          setSessionId(message.sessionId)
          setIsSessionCreator(true)
          // Auto-join the created session
          ws.send(JSON.stringify({
            type: 'join_session',
            sessionId: message.sessionId,
            username: username || 'Player'
          }))
          break

        case 'session_joined':
          setSessionId(message.sessionId)
          setUserId(message.userId)
          setSelectedGames(message.gameState?.selectedGames || [])
          setIsSpinning(message.gameState?.isSpinning || false)
          setSpinData(message.gameState?.spinData || null)
          setGameLimit(message.gameState?.gameLimit || null)
          setUserGameCounts(message.gameState?.userGameCounts || {})
          setUsers(message.users)
          setShowSessionInput(false)
          
          // Always use server's winner, whether from final state or pre-calculated
          if (message.gameState?.winner) {
            setWinner(message.gameState.winner)
          } else if (message.gameState?.spinData?.preCalculatedWinner) {
            setWinner(message.gameState.spinData.preCalculatedWinner)
          } else {
            setWinner(null)
          }
          break

        case 'game_state_update':
          setSelectedGames(message.gameState?.selectedGames || [])
          setIsSpinning(message.gameState?.isSpinning || false)
          setSpinData(message.gameState?.spinData || null)
          setGameLimit(message.gameState?.gameLimit || null)
          setUserGameCounts(message.gameState?.userGameCounts || {})
          
          // Always use server's winner, whether from final state or pre-calculated
          if (message.gameState?.winner) {
            setWinner(message.gameState.winner)
          } else if (message.gameState?.spinData?.preCalculatedWinner) {
            setWinner(message.gameState.spinData.preCalculatedWinner)
          } else {
            setWinner(null)
          }
          break

        case 'user_joined':
        case 'user_left':
          setUsers(message.users)
          break

        case 'kicked':
          alert(message.message)
          returnToSessionSetup()
          break

        case 'error':
          alert('Error: ' + message.message)
          break
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = (error) => {
      setConnected(false)
    }
  }

  const createSession = () => {
    if (!wsRef.current) connectWebSocket()
    
    setTimeout(() => {
      wsRef.current?.send(JSON.stringify({
        type: 'create_session'
      }))
    }, 100)
  }

  const joinSession = (sessionIdInput) => {
    if (!wsRef.current) connectWebSocket()
    
    setTimeout(() => {
      wsRef.current?.send(JSON.stringify({
        type: 'join_session',
        sessionId: sessionIdInput,
        username: username || 'Player'
      }))
    }, 100)
  }

  const handleGameSelect = (game) => {
    if (!selectedGames.find(g => g.name === game.name) && wsRef.current) {
      // Check if user has reached their game limit (client-side check)
      const currentUserCount = userGameCounts[userId] || 0
      if (gameLimit && currentUserCount >= gameLimit) {
        alert(`You can only submit ${gameLimit} game${gameLimit === 1 ? '' : 's'}.`)
        return
      }
      
      // Don't optimistically update - let the server response update the UI
      // This prevents the UI from showing games that get rejected by the server
      
      // Send to server
      wsRef.current.send(JSON.stringify({
        type: 'game_action',
        action: 'add_game',
        data: { game }
      }))
    }
  }

  const handleRemoveGame = (gameToRemove) => {
    if (wsRef.current) {
      // Don't optimistically update - let the server response update the UI
      // This keeps the UI consistent with the server state
      
      // Send to server
      wsRef.current.send(JSON.stringify({
        type: 'game_action',
        action: 'remove_game',
        data: { gameName: gameToRemove.name }
      }))
    }
  }

  const handleSpin = () => {
    if (selectedGames.length === 0 || !wsRef.current) return
    
    // Send to server (let server handle all state updates)
    wsRef.current.send(JSON.stringify({
      type: 'game_action',
      action: 'start_spin'
    }))
  }


  const returnToSessionSetup = () => {
    // Disconnect from current session
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null // Clear the reference
    }
    
    // Reset all session-related state but keep username
    setSessionId(null)
    setUserId(null)
    setUsers([])
    setSelectedGames([])
    setIsSpinning(false)
    setWinner(null)
    setSpinData(null)
    setConnected(false)
    setIsSessionCreator(false)
    setGameLimit(null)
    setUserGameCounts({})
    setShowSessionInput(true)
  }

  const clearAllGames = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'game_action',
        action: 'clear_all_games'
      }))
    }
  }

  const kickUser = (userToKick) => {
    if (wsRef.current && isSessionCreator) {
      wsRef.current.send(JSON.stringify({
        type: 'kick_user',
        userId: userToKick.user_id
      }))
    }
  }

  const setGameLimitHandler = (limit) => {
    if (wsRef.current && isSessionCreator) {
      wsRef.current.send(JSON.stringify({
        type: 'set_game_limit',
        limit: limit
      }))
    }
  }

  if (showSessionInput) {
    return (
      <div className="app">
        <h1>Spin & Pick</h1>
        <div className="session-setup">
          <div className="username-input">
            <input
              type="text"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          
          <div className="session-actions">
            <button onClick={createSession}>Create New Session</button>
            <div className="join-section">
              <input
                type="text"
                placeholder="Session ID"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.target.value) {
                    joinSession(e.target.value)
                  }
                }}
              />
              <button onClick={(e) => {
                const input = e.target.previousElementSibling
                if (input.value) joinSession(input.value)
              }}>Join Session</button>
            </div>
          </div>
          
          <div className="connection-status">
            Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="session-header">
        <h1 onClick={returnToSessionSetup} className="clickable-title">Spin & Pick</h1>
        <div className="session-info">
          <div className="session-id-container">
            <span>Session: {sessionId}</span>
            <button 
              className="copy-button"
              onClick={() => {
                navigator.clipboard.writeText(sessionId)
                  .then(() => {
                    const btn = document.querySelector('.copy-button')
                    const originalText = btn.textContent
                    btn.textContent = '✓'
                    setTimeout(() => btn.textContent = originalText, 1000)
                  })
                  .catch(() => alert('Failed to copy session ID'))
              }}
              title="Copy session ID"
            >
              📋
            </button>
          </div>
          <span>Users: {users.length}</span>
          <span>{connected ? '🟢' : '🔴'}</span>
        </div>
      </div>
      
      {users.length > 0 && (
        <div className="user-list">
          <h4>Connected Users:</h4>
          <div className="users">
            {users.map((user, index) => (
              <div key={user.user_id} className={`user-badge ${user.user_id === userId ? 'current-user' : ''}`}>
                <span>
                  {user.username}
                  {index === 0 && ' (creator)'}
                  {user.user_id === userId && ' (you)'}
                </span>
                {isSessionCreator && user.user_id !== userId && (
                  <button 
                    className="kick-button"
                    onClick={() => kickUser(user)}
                    title="Kick user"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {isSessionCreator && (
        <div className="creator-controls">
          <h4>Creator Settings:</h4>
          <div className="game-limit-controls">
            <label>Games per user: </label>
            <select 
              value={gameLimit || 'unlimited'} 
              onChange={(e) => {
                const value = e.target.value === 'unlimited' ? null : parseInt(e.target.value)
                setGameLimitHandler(value)
              }}
            >
              <option value="unlimited">Unlimited</option>
              <option value="1">1 game</option>
              <option value="2">2 games</option>
              <option value="3">3 games</option>
              <option value="5">5 games</option>
              <option value="10">10 games</option>
            </select>
          </div>
        </div>
      )}
      
      <div className="game-selector">
        <GameAutocomplete 
          games={games} 
          onGameSelect={handleGameSelect}
        />
      </div>

      <div className="selected-games">
        <div className="selected-games-header">
          <div>
            <h3>Selected Games ({selectedGames.length})</h3>
            {gameLimit && (
              <p className="user-game-count">
                Your games: {userGameCounts[userId] || 0}/{gameLimit}
              </p>
            )}
          </div>
          {selectedGames.length > 0 && (
            <button className="clear-all-button" onClick={clearAllGames}>
              Clear All
            </button>
          )}
        </div>
        <div className="game-list">
          {selectedGames.map((game, index) => (
            <div key={index} className="game-item">
              <span>{game.name}</span>
              <button onClick={() => handleRemoveGame(game)}>×</button>
            </div>
          ))}
        </div>
      </div>

      {selectedGames.length > 0 && (
        <div className="wheel-section">
          <SpinningWheel 
            games={selectedGames}
            isSpinning={isSpinning}
            winner={winner}
            spinData={spinData}
          />
          
          <button 
            className="spin-button"
            onClick={handleSpin}
            disabled={isSpinning}
          >
            {isSpinning ? 'Spinning...' : 'Spin the Wheel!'}
          </button>

          {winner && !isSpinning && (
            <div className="winner">
              <h2>🎉 Winner: {winner.name} 🎉</h2>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
