const MUTE_KEY = 'skydeck.muted'
const MIN_GAP_MS = 1_500

let audio: AudioContext | undefined
let lastPlayed = 0

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
}

/**
 * Browsers keep audio suspended until the user has interacted with the page,
 * so the first click or key press anywhere readies the chime.
 */
export function armChime() {
  const unlock = () => {
    audio ??= new AudioContext()
    void audio.resume()
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** A short two-note chime, synthesised so the app ships no audio file. */
export function playChime() {
  const now = Date.now()
  if (isMuted() || !audio || audio.state !== 'running' || now - lastPlayed < MIN_GAP_MS) return
  lastPlayed = now
  const t0 = audio.currentTime
  for (const [freq, at] of [
    [880, 0],
    [1174.66, 0.12],
  ]) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t0 + at)
    gain.gain.linearRampToValueAtTime(0.18, t0 + at + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.45)
    osc.connect(gain).connect(audio.destination)
    osc.start(t0 + at)
    osc.stop(t0 + at + 0.5)
  }
}
