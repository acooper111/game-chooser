import { useEffect, useRef } from 'react'
import './SpinningWheel.css'

function SpinningWheel({ games, isSpinning, spinData }) {
  const canvasRef = useRef()
  const animationRef = useRef()
  const rotationRef = useRef(0)
  const spinSpeedRef = useRef(0)

  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || games.length === 0) return

    const ctx = canvas.getContext('2d')
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radius = Math.min(centerX, centerY) - 10

    // Sort games alphabetically to match server order
    const sortedGames = [...games].sort((a, b) => a.name.localeCompare(b.name))

    const drawWheel = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const anglePerSection = (2 * Math.PI) / sortedGames.length

      sortedGames.forEach((game, index) => {
        const startAngle = index * anglePerSection + rotationRef.current
        const endAngle = startAngle + anglePerSection

        ctx.beginPath()
        ctx.arc(centerX, centerY, radius, startAngle, endAngle)
        ctx.lineTo(centerX, centerY)
        ctx.fillStyle = colors[index % colors.length]
        ctx.fill()
        ctx.stroke()

        ctx.save()
        ctx.translate(centerX, centerY)
        ctx.rotate(startAngle + anglePerSection / 2)
        ctx.textAlign = 'center'
        ctx.fillStyle = '#333'
        ctx.font = 'bold 16px Arial'
        
        const text = game.name.length > 20 ? game.name.substring(0, 16) + '...' : game.name
        ctx.fillText(text, radius * 0.6, 5)
        ctx.restore()
      })

      // Draw arrow pointing up
      ctx.beginPath()
      ctx.moveTo(centerX, centerY - radius + 10)
      ctx.lineTo(centerX - 10, centerY - radius - 10)
      ctx.lineTo(centerX + 10, centerY - radius - 10)
      ctx.closePath()
      ctx.fillStyle = '#333'
      ctx.fill()
    }


    const animate = () => {
      if (isSpinning) {
        if (spinData) {
          // Server-controlled spin with synchronized timing
          const elapsed = Date.now() - spinData.startTime
          const progress = Math.min(elapsed / spinData.duration, 1)
          
          if (progress < 1) {
            // Ease out deceleration using server's final rotation
            const easeProgress = 1 - Math.pow(1 - progress, 3) // Cubic ease-out
            rotationRef.current = spinData.finalRotation * easeProgress
            drawWheel()
            animationRef.current = requestAnimationFrame(animate)
          } else {
            // Spinning is complete - use server's final rotation
            rotationRef.current = spinData.finalRotation
            
            
            drawWheel()
          }
        } else {
          // No spinData yet - just draw the wheel (no spinning)
          drawWheel()
        }
      } else {
        // Reset spin speed when not spinning
        spinSpeedRef.current = 0
        drawWheel()
      }
    }

    animate()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [games, isSpinning, spinData])

  if (games.length === 0) {
    return <div className="wheel-placeholder">Add games to see the wheel!</div>
  }

  return (
    <div className="spinning-wheel">
      <canvas
        ref={canvasRef}
        width={400}
        height={400}
        className="wheel-canvas"
      />
    </div>
  )
}

export default SpinningWheel