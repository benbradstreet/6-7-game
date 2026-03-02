import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Zap, Skull, Trophy, Share2, Download, Instagram } from 'lucide-react';
import html2canvas from 'html2canvas';

// --- Audio Engine ---
class Synth {
  ctx: AudioContext | null = null;
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playHit(type: '6' | '7') {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(type === '6' ? 330 : 440, this.ctx.currentTime);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playMiss() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.2);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}

const synth = new Synth();

// --- Game Types & Constants ---
type Note = {
  id: number;
  lane: 0 | 1;
  y: number;
  hit: boolean;
  missed: boolean;
};

type Feedback = {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const TARGET_Y = 500;
const NOTE_RADIUS = 30;
const HIT_WINDOW = 60;
const PERFECT_WINDOW = 20;
const LANES = [CANVAS_WIDTH * 0.25, CANVAS_WIDTH * 0.75];

// --- Score Tiers ---
const getScoreTier = (score: number) => {
  if (score < 1500) {
    return {
      title: "Major L",
      message: "You failed the vibe check. You have been exiled from the group chat.",
      color: "text-red-500",
      shadow: "drop-shadow-[0_0_10px_rgba(239,68,68,0.3)]",
      icon: <Skull size={56} className="text-red-500 mb-4 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
    };
  } else if (score < 5000) {
    return {
      title: "Mid",
      message: "Not terrible, but definitely not passing the vibe check. Do better.",
      color: "text-yellow-500",
      shadow: "drop-shadow-[0_0_10px_rgba(234,179,8,0.3)]",
      icon: <div className="text-5xl mb-4">😐</div>
    };
  } else if (score < 15000) {
    return {
      title: "Valid",
      message: "You're getting there. The group chat is considering your application.",
      color: "text-green-400",
      shadow: "drop-shadow-[0_0_10px_rgba(74,222,128,0.3)]",
      icon: <div className="text-5xl mb-4">🔥</div>
    };
  } else {
    return {
      title: "W Rizz",
      message: "You passed the vibe check. You are the main character.",
      color: "text-cyan-400",
      shadow: "drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]",
      icon: <div className="text-5xl mb-4">👑</div>
    };
  }
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultCardRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [vibe, setVibe] = useState(50);
  const [isSharing, setIsSharing] = useState(false);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  
  const gameRef = useRef({
    notes: [] as Note[],
    feedbacks: [] as Feedback[],
    speed: 5,
    baseSpeed: 5,
    baseSpawnInterval: 1000,
    minSpawnInterval: 300,
    lastSpawnTime: 0,
    spawnInterval: 1000,
    score: 0,
    combo: 0,
    vibe: 50,
    noteIdCounter: 0,
    feedbackIdCounter: 0,
    keysPressed: { '6': false, '7': false },
    laneActive: [0, 0],
    particles: [] as Particle[],
    hitFlashes: [0, 0], // For lane flash effect
  });

  const requestRef = useRef<number>(null);

  // --- Game Loop ---
  const update = useCallback((time: number) => {
    if (gameState !== 'playing') return;
    
    const state = gameRef.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    // Difficulty scaling
    state.speed = state.baseSpeed + Math.floor(state.score / 1000);
    state.spawnInterval = Math.max(state.minSpawnInterval, state.baseSpawnInterval - Math.floor(state.score / 50) * 50);

    // Spawn notes
    if (time - state.lastSpawnTime > state.spawnInterval) {
      const pattern = Math.random();
      if (pattern > 0.8 && state.speed > 6) {
        state.notes.push({ id: state.noteIdCounter++, lane: 0, y: -50, hit: false, missed: false });
        state.notes.push({ id: state.noteIdCounter++, lane: 1, y: -50, hit: false, missed: false });
      } else {
        const lane = Math.random() > 0.5 ? 1 : 0;
        state.notes.push({ id: state.noteIdCounter++, lane, y: -50, hit: false, missed: false });
      }
      state.lastSpawnTime = time;
    }

    // Update notes
    for (let i = state.notes.length - 1; i >= 0; i--) {
      const note = state.notes[i];
      if (!note.hit && !note.missed) {
        note.y += state.speed;
        
        if (note.y > TARGET_Y + HIT_WINDOW) {
          note.missed = true;
          state.combo = 0;
          state.vibe = Math.max(0, state.vibe - 10);
          synth.playMiss();
          addFeedback("L + Ratio", LANES[note.lane], TARGET_Y + 40, "#ef4444");
          
          if (state.vibe <= 0) {
            setGameState('gameover');
          }
        }
      }
    }

    state.notes = state.notes.filter(n => !n.hit && !n.missed);

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.4; // Gravity
      p.vx *= 0.95; // Friction
      p.life -= 0.03;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      }
    }

    // Update feedbacks
    state.feedbacks = state.feedbacks.filter(f => time - f.createdAt < 1000);
    state.feedbacks.forEach(f => {
      f.y -= 0.5;
    });

    // Sync React state
    if (Math.floor(time) % 5 === 0) {
      setScore(state.score);
      setCombo(state.combo);
      setVibe(state.vibe);
      setMaxCombo(prev => Math.max(prev, state.combo));
    }

    // Render
    draw(ctx, state, time);

    // Fade active states
    state.laneActive[0] = Math.max(0, state.laneActive[0] - 0.1);
    state.laneActive[1] = Math.max(0, state.laneActive[1] - 0.1);
    state.hitFlashes[0] = Math.max(0, state.hitFlashes[0] - 0.05);
    state.hitFlashes[1] = Math.max(0, state.hitFlashes[1] - 0.05);

    requestRef.current = requestAnimationFrame(update);
  }, [gameState]);

  const draw = (ctx: CanvasRenderingContext2D, state: typeof gameRef.current, time: number) => {
    // Clear background
    ctx.fillStyle = '#09090b'; // zinc-950
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw scrolling synthwave grid
    ctx.lineWidth = 1;
    const gridOffset = (time / 20) % 40;
    
    // Horizontal lines
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
      const opacity = Math.min(1, y / CANVAS_HEIGHT); // Fade out at top
      ctx.strokeStyle = `rgba(39, 39, 42, ${opacity * 0.5})`; // zinc-800
      ctx.beginPath();
      ctx.moveTo(0, y + gridOffset);
      ctx.lineTo(CANVAS_WIDTH, y + gridOffset);
      ctx.stroke();
    }
    
    // Vertical perspective lines
    for (let x = -200; x <= CANVAS_WIDTH + 200; x += 40) {
      ctx.strokeStyle = `rgba(39, 39, 42, 0.3)`;
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }

    // Draw lanes
    for (let i = 0; i < 2; i++) {
      const x = LANES[i];
      const color = i === 0 ? '6, 182, 212' : '217, 70, 239'; // cyan-500 : fuchsia-500
      
      // Lane glow gradient
      const laneGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      laneGrad.addColorStop(0, 'rgba(0,0,0,0)');
      laneGrad.addColorStop(0.8, `rgba(${color}, ${state.laneActive[i] * 0.3 + 0.05})`);
      laneGrad.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = laneGrad;
      ctx.fillRect(x - NOTE_RADIUS, 0, NOTE_RADIUS * 2, CANVAS_HEIGHT);

      // Target Receptors
      ctx.save();
      ctx.translate(x, TARGET_Y);
      
      // Receptor glow
      if (state.laneActive[i] > 0) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = `rgb(${color})`;
      }

      // Outer ring
      ctx.beginPath();
      ctx.arc(0, 0, NOTE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = state.laneActive[i] > 0 ? `rgb(${color})` : '#52525b';
      ctx.lineWidth = state.laneActive[i] > 0 ? 4 : 2;
      ctx.stroke();

      // Inner ring (scales when pressed)
      const innerScale = 1 - (state.laneActive[i] * 0.2);
      ctx.beginPath();
      ctx.arc(0, 0, NOTE_RADIUS * 0.7 * innerScale, 0, Math.PI * 2);
      ctx.strokeStyle = state.laneActive[i] > 0 ? '#fff' : '#3f3f46';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Hit flash
      if (state.hitFlashes[i] > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, NOTE_RADIUS * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${state.hitFlashes[i] * 0.5})`;
        ctx.fill();
      }

      ctx.restore();
      
      // Target label
      ctx.fillStyle = state.laneActive[i] > 0 ? '#ffffff' : '#71717a';
      ctx.font = 'bold 24px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(i === 0 ? '6' : '7', x, TARGET_Y);
    }

    // Draw notes
    state.notes.forEach(note => {
      const x = LANES[note.lane];
      const color = note.lane === 0 ? '#06b6d4' : '#d946ef';
      
      ctx.save();
      
      // Note trail
      const trailGrad = ctx.createLinearGradient(x, note.y, x, note.y - 60);
      trailGrad.addColorStop(0, color);
      trailGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = trailGrad;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, note.y, NOTE_RADIUS * 0.8, 0, Math.PI);
      ctx.lineTo(x - NOTE_RADIUS * 0.8, note.y - 60);
      ctx.lineTo(x + NOTE_RADIUS * 0.8, note.y - 60);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Note body (3D sphere effect)
      const grad = ctx.createRadialGradient(x - 5, note.y - 5, 2, x, note.y, NOTE_RADIUS * 0.8);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, color);
      grad.addColorStop(1, '#000000');
      
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      
      ctx.beginPath();
      ctx.arc(x, note.y, NOTE_RADIUS * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      
      // Note text
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(note.lane === 0 ? '6' : '7', x, note.y);
      
      ctx.restore();
    });

    // Draw particles (Sparks)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    state.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      // Draw a line based on velocity to look like a motion-blurred spark
      ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
      ctx.stroke();
    });
    ctx.restore();

    // Draw feedbacks
    state.feedbacks.forEach(f => {
      const age = time - f.createdAt;
      const progress = Math.min(1, age / 1000);
      
      // Pop-in scale effect
      let scale = 1;
      if (age < 150) {
        scale = 0.5 + (age / 150) * 0.7; // Scale up to 1.2
      } else if (age < 300) {
        scale = 1.2 - ((age - 150) / 150) * 0.2; // Settle to 1.0
      }

      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.scale(scale, scale);
      
      ctx.globalAlpha = 1 - Math.pow(progress, 3); // Fade out faster at the end
      ctx.fillStyle = f.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = f.color;
      ctx.font = 'black 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      
      // Text stroke for better readability
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, 0, 0);
      ctx.fillText(f.text, 0, 0);
      
      ctx.restore();
    });
  };

  const addFeedback = (text: string, x: number, y: number, color: string) => {
    gameRef.current.feedbacks.push({
      id: gameRef.current.feedbackIdCounter++,
      text,
      x,
      y,
      color,
      createdAt: performance.now()
    });
  };

  const createParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 8 + 4;
      gameRef.current.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 5, // Initial upward burst
        life: 1.0,
        color,
        size: Math.random() * 3 + 1
      });
    }
  };

  const handleInput = useCallback((lane: 0 | 1) => {
    if (gameState !== 'playing') return;
    
    synth.init();
    const state = gameRef.current;
    state.laneActive[lane] = 1.0;
    
    const note = state.notes.find(n => n.lane === lane && !n.hit && !n.missed && n.y > TARGET_Y - HIT_WINDOW);
    
    if (note) {
      const dist = Math.abs(note.y - TARGET_Y);
      note.hit = true;
      state.hitFlashes[lane] = 1.0; // Trigger flash
      
      synth.playHit(lane === 0 ? '6' : '7');
      createParticles(LANES[lane], TARGET_Y, lane === 0 ? '#06b6d4' : '#d946ef');

      if (dist <= PERFECT_WINDOW) {
        state.score += 100 * (1 + Math.floor(state.combo / 10));
        state.combo += 1;
        state.vibe = Math.min(100, state.vibe + 5);
        addFeedback("It's giving PERFECT", LANES[lane], TARGET_Y - 40, "#22c55e");
      } else if (dist <= HIT_WINDOW) {
        state.score += 50 * (1 + Math.floor(state.combo / 10));
        state.combo += 1;
        state.vibe = Math.min(100, state.vibe + 2);
        addFeedback("No cap", LANES[lane], TARGET_Y - 40, "#eab308");
      }
    } else {
      state.combo = 0;
      state.vibe = Math.max(0, state.vibe - 5);
      synth.playMiss();
      addFeedback("Awkward...", LANES[lane], TARGET_Y - 40, "#ef4444");
      
      if (state.vibe <= 0) {
        setGameState('gameover');
      }
    }
  }, [gameState]);

  // --- Event Listeners ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '6' && !gameRef.current.keysPressed['6']) {
        gameRef.current.keysPressed['6'] = true;
        handleInput(0);
      } else if (e.key === '7' && !gameRef.current.keysPressed['7']) {
        gameRef.current.keysPressed['7'] = true;
        handleInput(1);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === '6') gameRef.current.keysPressed['6'] = false;
      if (e.key === '7') gameRef.current.keysPressed['7'] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleInput]);

  // --- Game Loop Lifecycle ---
  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, update]);

  // --- Game Controls ---
  const startGame = () => {
    synth.init();
    
    let baseSpeed = 5;
    let baseSpawnInterval = 1000;
    let minSpawnInterval = 300;
    
    if (difficulty === 'easy') {
      baseSpeed = 3;
      baseSpawnInterval = 1200;
      minSpawnInterval = 500;
    } else if (difficulty === 'hard') {
      baseSpeed = 8;
      baseSpawnInterval = 700;
      minSpawnInterval = 200;
    }

    gameRef.current = {
      notes: [],
      feedbacks: [],
      speed: baseSpeed,
      baseSpeed,
      baseSpawnInterval,
      minSpawnInterval,
      lastSpawnTime: performance.now(),
      spawnInterval: baseSpawnInterval,
      score: 0,
      combo: 0,
      vibe: 50,
      noteIdCounter: 0,
      feedbackIdCounter: 0,
      keysPressed: { '6': false, '7': false },
      laneActive: [0, 0],
      particles: [],
      hitFlashes: [0, 0],
    };
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setVibe(50);
    setGameState('playing');
  };

  const handleShare = async () => {
    if (!resultCardRef.current) return;
    
    setIsSharing(true);
    try {
      // Small delay to let the UI update (hide buttons if needed, though we'll just capture the card)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await html2canvas(resultCardRef.current, {
        backgroundColor: '#09090b',
        scale: 2, // Higher resolution
        logging: false,
        useCORS: true
      });
      
      const imageBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      });

      if (!imageBlob) throw new Error("Could not generate image");

      const file = new File([imageBlob], 'vibe-check-result.png', { type: 'image/png' });

      // Try Web Share API first (works on mobile for Instagram)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: '6, 7 Vibe Check',
          text: `I scored ${score.toLocaleString()} on the 6, 7 Vibe Check! Can you beat my score?`,
          files: [file]
        });
      } else {
        // Fallback: Download the image
        const url = URL.createObjectURL(imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vibe-check-result.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert("Image downloaded! You can now share it to your Instagram Story.");
      }
    } catch (error) {
      console.error("Error sharing:", error);
      alert("Oops, couldn't generate the image. Try again!");
    } finally {
      setIsSharing(false);
    }
  };

  const tier = getScoreTier(score);

  // --- Render ---
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center font-sans overflow-hidden selection:bg-cyan-500/30">
      
      {/* Main Game Container */}
      <div className="relative w-full max-w-[400px] h-[600px] bg-zinc-950 rounded-3xl shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden border border-zinc-800">
        
        {/* Header / HUD */}
        <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-10 pointer-events-none">
          <div className="flex flex-col gap-1">
            <div className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 to-fuchsia-500 drop-shadow-md">
              {score.toLocaleString()}
            </div>
            <div className={`text-sm font-bold flex items-center gap-1 ${combo > 10 ? 'text-fuchsia-400 animate-pulse drop-shadow-[0_0_8px_rgba(217,70,239,0.8)]' : 'text-zinc-400'}`}>
              <Zap size={14} className={combo > 10 ? 'fill-fuchsia-400' : ''} />
              {combo}x COMBO
            </div>
          </div>
          
          {/* Vibe Meter */}
          <div className="flex flex-col items-end gap-2 w-32">
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Vibe Check</div>
            <div className="w-full h-3 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 shadow-inner">
              <motion.div 
                className={`h-full ${vibe > 70 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : vibe > 30 ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.8)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'}`}
                animate={{ width: `${vibe}%` }}
                transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              />
            </div>
          </div>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-full touch-none"
          onClick={(e) => {
            if (gameState !== 'playing') return;
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            const x = e.clientX - rect.left;
            if (x < CANVAS_WIDTH / 2) handleInput(0);
            else handleInput(1);
          }}
        />

        {/* Overlays */}
        <AnimatePresence>
          {gameState === 'start' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20"
            >
              <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 to-fuchsia-500 rounded-3xl transform rotate-6 opacity-50 blur-xl animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 to-fuchsia-500 rounded-3xl flex items-center justify-center shadow-2xl transform -rotate-3 border border-white/20">
                  <span className="text-5xl font-black text-white rotate-3 drop-shadow-md">6 7</span>
                </div>
              </div>
              
              <h1 className="text-4xl font-black tracking-tight mb-3 text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">The Vibe Check</h1>
              <p className="text-zinc-400 mb-8 max-w-[260px] leading-relaxed">
                Hit <span className="text-cyan-400 font-bold drop-shadow-[0_0_5px_rgba(6,182,212,0.5)]">6</span> and <span className="text-fuchsia-400 font-bold drop-shadow-[0_0_5px_rgba(217,70,239,0.5)]">7</span> to the beat to signal you belong. Don't make it awkward.
              </p>
              
              <div className="flex gap-2 mb-8">
                {(['easy', 'medium', 'hard'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setDifficulty(level)}
                    className={`px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider transition-colors ${
                      difficulty === level 
                        ? 'bg-cyan-500 text-zinc-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]' 
                        : 'bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
              
              <button 
                onClick={startGame}
                className="group relative px-8 py-4 bg-white text-zinc-950 font-black rounded-full text-lg hover:scale-105 transition-all active:scale-95 flex items-center gap-3 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
              >
                <Play size={22} className="fill-zinc-950" />
                Pass the Vibe Check
                <div className="absolute inset-0 rounded-full ring-2 ring-white ring-offset-4 ring-offset-zinc-950 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              
              <div className="mt-10 text-xs text-zinc-500 font-mono tracking-widest uppercase">
                Press 6 (Left) / 7 (Right) or Tap
              </div>
            </motion.div>
          )}

          {gameState === 'gameover' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-zinc-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center z-20 overflow-y-auto"
            >
              {/* This is the card we will screenshot */}
              <div ref={resultCardRef} className="flex flex-col items-center w-full max-w-[320px] p-6 bg-zinc-950/50 rounded-3xl border border-zinc-800/50 shadow-2xl backdrop-blur-sm">
                <motion.div 
                  initial={{ rotate: -10, scale: 0.5 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', bounce: 0.5 }}
                >
                  {tier.icon}
                </motion.div>
                
                <h2 className={`text-5xl font-black tracking-tight mb-3 ${tier.color} ${tier.shadow}`}>{tier.title}</h2>
                <p className="text-zinc-400 mb-8 max-w-[250px] text-sm leading-relaxed">{tier.message}</p>
                
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-5 w-full mb-4 flex flex-col gap-4 shadow-inner">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500 font-bold uppercase text-xs tracking-widest">Final Score</span>
                    <span className="text-3xl font-black text-white drop-shadow-md">{score.toLocaleString()}</span>
                  </div>
                  <div className="h-px w-full bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500 font-bold uppercase text-xs tracking-widest flex items-center gap-2">
                      <Trophy size={14} className="text-fuchsia-400" /> Max Combo
                    </span>
                    <span className="text-xl font-black text-fuchsia-400 drop-shadow-[0_0_8px_rgba(217,70,239,0.5)]">{maxCombo}x</span>
                  </div>
                </div>
                
                {/* Branding for the screenshot */}
                <div className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest mt-2">
                  6, 7 Vibe Check
                </div>
              </div>

              <div className="flex flex-col gap-3 mt-6 w-full max-w-[320px]">
                <button 
                  onClick={handleShare}
                  disabled={isSharing}
                  className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-black rounded-full text-base hover:scale-105 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(219,39,119,0.4)] disabled:opacity-50 disabled:hover:scale-100"
                >
                  {isSharing ? (
                    <span className="animate-pulse">Generating...</span>
                  ) : (
                    <>
                      <Instagram size={20} />
                      Share to IG Story
                    </>
                  )}
                </button>

                <button 
                  onClick={startGame}
                  className="w-full py-4 bg-zinc-800 text-zinc-100 font-bold rounded-full text-base hover:bg-zinc-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <RotateCcw size={20} />
                  Play Again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
