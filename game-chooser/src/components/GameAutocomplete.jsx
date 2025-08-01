import { useState, useRef, useEffect } from 'react'
import './GameAutocomplete.css'

function GameAutocomplete({ games, onGameSelect }) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const inputRef = useRef()

  useEffect(() => {
    if (input.length > 0) {
      const filteredSuggestions = games.filter(game =>
        game.name.toLowerCase().includes(input.toLowerCase())
      ).slice(0, 10)
      setSuggestions(filteredSuggestions)
      setShowSuggestions(true)
      setActiveSuggestion(-1)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }, [input, games])

  const handleInputChange = (e) => {
    setInput(e.target.value)
  }

  const handleSuggestionClick = (game) => {
    onGameSelect(game)
    setInput('')
    setShowSuggestions(false)
    inputRef.current.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestion(prev => 
        prev < suggestions.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestion(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
        handleSuggestionClick(suggestions[activeSuggestion])
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setActiveSuggestion(-1)
    }
  }

  return (
    <div className="autocomplete-container">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Start typing a game name..."
        className="game-input"
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div className="suggestions-list">
          {suggestions.map((game, index) => (
            <div
              key={index}
              className={`suggestion-item ${index === activeSuggestion ? 'active' : ''}`}
              onClick={() => handleSuggestionClick(game)}
            >
              <div className="game-name">{game.name}</div>
              <div className="game-details">
                <span className="genre">{game.genre}</span>
                <span className="platform">{game.platform}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default GameAutocomplete