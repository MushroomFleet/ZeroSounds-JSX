import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ============================================================================
// ZEROSOUNDS.JSX
// ZeroByes-aligned SNES-style audio synthesis engine
// Architecture: position-is-seed, zero bytes store infinity
// Every parameter derived O(1) from (soundName, worldSeed) via hash chain
// No Math.random() — full determinism and cross-session reproducibility
// ============================================================================

// ============================================================================
// SECTION 1: ZB HASH CORE
// Murmur3 finaliser mix — platform-safe, same output on all JS engines
// ============================================================================
function zbHash(key, seed = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  if (typeof key === 'number') {
    h ^= (key >>> 0);
    h = Math.imul(h, 0xcc9e2d51) >>> 0;
    h = ((h << 15) | (h >>> 17)) >>> 0;
    h = Math.imul(h, 0x1b873593) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  // String path
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

// Derive a float in [0, 1)
function zbFloat(hash) {
  return (hash & 0xFFFFFF) / 0x1000000;
}

// Derive a float in [min, max]
function zbRange(hash, min, max) {
  return min + zbFloat(hash) * (max - min);
}

// Derive an integer in [min, max]
function zbInt(hash, min, max) {
  return min + (hash % (max - min + 1));
}

// ============================================================================
// SECTION 2: SOUND TAXONOMY (anchor data only — no params stored)
// ============================================================================
const ZB_CATEGORIES = {
  movement:    { index: 0, freqLow: 80,   freqHigh: 400,  durLow: 0.06, durHigh: 0.25 },
  pickup:      { index: 1, freqLow: 500,  freqHigh: 1800, durLow: 0.12, durHigh: 0.5  },
  combat:      { index: 2, freqLow: 100,  freqHigh: 1200, durLow: 0.06, durHigh: 0.5  },
  explosion:   { index: 3, freqLow: 40,   freqHigh: 300,  durLow: 0.15, durHigh: 0.9  },
  ui:          { index: 4, freqLow: 300,  freqHigh: 1000, durLow: 0.03, durHigh: 0.2  },
  power:       { index: 5, freqLow: 200,  freqHigh: 1200, durLow: 0.3,  durHigh: 1.0  },
  damage:      { index: 6, freqLow: 100,  freqHigh: 600,  durLow: 0.08, durHigh: 0.8  },
  environment: { index: 7, freqLow: 80,   freqHigh: 600,  durLow: 0.06, durHigh: 0.5  },
};

// style: 0=tonal, 1=noisy, 2=arpeggio
const ZB_SOUNDS = {
  jump:          { category: 'movement',    style: 0, styleIndex: 0, label: '⬆ Jump'       },
  doubleJump:    { category: 'movement',    style: 2, styleIndex: 1, label: '⬆⬆ Dbl Jump'  },
  dash:          { category: 'movement',    style: 1, styleIndex: 2, label: '⚡ Dash'        },
  land:          { category: 'movement',    style: 1, styleIndex: 3, label: '⬇ Land'        },
  coin:          { category: 'pickup',      style: 2, styleIndex: 0, label: '🪙 Coin'        },
  gem:           { category: 'pickup',      style: 2, styleIndex: 1, label: '💎 Gem'         },
  heart:         { category: 'pickup',      style: 2, styleIndex: 2, label: '❤ Heart'        },
  key:           { category: 'pickup',      style: 0, styleIndex: 3, label: '🗝 Key'          },
  laser:         { category: 'combat',      style: 0, styleIndex: 0, label: '🔴 Laser'       },
  blaster:       { category: 'combat',      style: 1, styleIndex: 1, label: '💥 Blaster'     },
  sword:         { category: 'combat',      style: 1, styleIndex: 2, label: '⚔ Sword'        },
  punch:         { category: 'combat',      style: 1, styleIndex: 3, label: '👊 Punch'       },
  magicSpell:    { category: 'combat',      style: 2, styleIndex: 4, label: '✨ Magic'        },
  explosion:     { category: 'explosion',   style: 1, styleIndex: 0, label: '💣 Explosion'   },
  smallExplosion:{ category: 'explosion',   style: 1, styleIndex: 1, label: '💥 Pop'          },
  boom:          { category: 'explosion',   style: 1, styleIndex: 2, label: '💥 Boom'         },
  menuSelect:    { category: 'ui',          style: 0, styleIndex: 0, label: '▶ Select'        },
  menuConfirm:   { category: 'ui',          style: 2, styleIndex: 1, label: '✓ Confirm'       },
  menuCancel:    { category: 'ui',          style: 0, styleIndex: 2, label: '✗ Cancel'        },
  pause:         { category: 'ui',          style: 0, styleIndex: 3, label: '⏸ Pause'         },
  textBlip:      { category: 'ui',          style: 0, styleIndex: 4, label: '💬 Text'         },
  powerUp:       { category: 'power',       style: 2, styleIndex: 0, label: '⚡ Power Up'     },
  levelUp:       { category: 'power',       style: 2, styleIndex: 1, label: '🏆 Level Up'     },
  oneUp:         { category: 'power',       style: 2, styleIndex: 2, label: '1UP Extra'       },
  heal:          { category: 'power',       style: 2, styleIndex: 3, label: '💚 Heal'         },
  hurt:          { category: 'damage',      style: 1, styleIndex: 0, label: '💔 Hurt'         },
  death:         { category: 'damage',      style: 2, styleIndex: 1, label: '☠ Death'         },
  enemyHit:      { category: 'damage',      style: 1, styleIndex: 2, label: '🎯 Enemy Hit'    },
  warning:       { category: 'damage',      style: 2, styleIndex: 3, label: '⚠ Warning'       },
  doorOpen:      { category: 'environment', style: 0, styleIndex: 0, label: '🚪 Door'         },
  chest:         { category: 'environment', style: 2, styleIndex: 1, label: '📦 Chest'        },
  splash:        { category: 'environment', style: 1, styleIndex: 2, label: '💧 Splash'       },
  teleport:      { category: 'environment', style: 0, styleIndex: 3, label: '🌀 Teleport'     },
  footstep:      { category: 'environment', style: 1, styleIndex: 4, label: '👣 Footstep'     },
};

const CATEGORY_COLORS = {
  movement:    '#4FC3F7',
  pickup:      '#FFD54F',
  combat:      '#EF5350',
  explosion:   '#FF7043',
  ui:          '#AB47BC',
  power:       '#66BB6A',
  damage:      '#F06292',
  environment: '#26A69A',
};

// ============================================================================
// SECTION 3: ZEROBYES PARAMETER DERIVATION (the core engine — O(1))
// ============================================================================
function zbDeriveParams(soundName, worldSeed = 0x1337BEEF) {
  const sound = ZB_SOUNDS[soundName];
  if (!sound) throw new Error(`Unknown sound: ${soundName}`);

  const cat = ZB_CATEGORIES[sound.category];

  // Seed hierarchy: world → category → sound → param slot
  const catSeed   = zbHash(cat.index, worldSeed);
  const soundSeed = zbHash(sound.styleIndex, catSeed);
  const h = (k) => zbHash(k, soundSeed);

  const waveforms = sound.style === 1
    ? ['noise', 'noise', 'sawtooth', 'square']
    : sound.style === 2
    ? ['square', 'square', 'sine', 'triangle']
    : ['sine', 'square', 'sawtooth', 'triangle'];

  const waveform   = waveforms[zbInt(h(0), 0, waveforms.length - 1)];
  const baseFreq   = zbRange(h(1), cat.freqLow, cat.freqHigh);
  const sweepLow   = sound.style === 1 ? 0.1 : 0.8;
  const sweepHigh  = sound.style === 1 ? 0.5 : 5.0;
  const freqSweep  = zbRange(h(2), sweepLow, sweepHigh);
  const duration   = zbRange(h(3), cat.durLow, cat.durHigh);
  const attackMax  = ['ui', 'combat'].includes(sound.category) ? 0.02 : 0.08;
  const attack     = zbRange(h(4), 0.001, attackMax);
  const decay      = zbRange(h(5), 0.02, 0.4);
  const sustain    = zbRange(h(6), 0.05, 0.7);
  const release    = zbRange(h(7), 0.01, 0.3);
  const filterFreq = zbRange(h(8), 400, 8000);
  const filterQ    = zbRange(h(9), 0.5, 6.0);
  const echoChance = ['environment', 'power', 'pickup'].includes(sound.category) ? 0.7 : 0.3;
  const useEcho    = zbFloat(h(10)) < echoChance;
  const echoDelay  = useEcho ? zbRange(h(11), 0.04, 0.3) : 0;
  const echoDecay  = useEcho ? zbRange(h(12), 0.1, 0.5) : 0;
  const crushLow   = ['explosion', 'damage'].includes(sound.category) ? 2 : 8;
  const crushHigh  = ['pickup', 'power'].includes(sound.category) ? 16 : 12;
  const bitCrush   = zbInt(h(13), crushLow, crushHigh);

  // Arpeggio — only style=2; each note derived from its own index hash (no sequential dep)
  let arpeggio = null;
  if (sound.style === 2) {
    const noteCount = zbInt(h(14), 2, 6);
    const notes = Array.from({ length: noteCount }, (_, i) => {
      const noteHash = zbHash(i, h(15));
      const interval = zbRange(noteHash, 1.0, 2.5);
      return i === 0 ? baseFreq : baseFreq * Math.pow(interval, i);
    });
    arpeggio = { notes, speed: zbRange(h(16), 0.04, 0.12) };
  }

  const addNoise    = sound.style === 1 && zbFloat(h(17)) > 0.3;
  const noiseAmount = addNoise ? zbRange(h(18), 0.1, 0.5) : 0;
  const addBass     = sound.category === 'explosion' && zbFloat(h(19)) > 0.4;
  const bassFreq    = addBass ? zbRange(h(20), 25, 80) : 0;

  return {
    soundSeed, waveform, baseFreq, freqSweep, duration,
    attack, decay, sustain, release,
    filterFreq, filterQ, echoDelay, echoDecay,
    bitCrush, arpeggio, addNoise, noiseAmount, addBass, bassFreq,
  };
}

// Deterministic "random" sound from a numeric seed — no Math.random()
function zbRandomize(numericSeed, worldSeed = 0x1337BEEF) {
  const vSeed  = zbHash(numericSeed, worldSeed);
  const cats   = Object.keys(ZB_CATEGORIES);
  const catIdx = zbInt(zbHash(0, vSeed), 0, cats.length - 1);
  const cat    = ZB_CATEGORIES[cats[catIdx]];
  const h      = (k) => zbHash(k, vSeed);
  return {
    soundSeed:   vSeed,
    waveform:    ['sine','square','sawtooth','triangle','noise'][zbInt(h(0), 0, 4)],
    baseFreq:    zbRange(h(1), cat.freqLow, cat.freqHigh),
    freqSweep:   zbRange(h(2), 0.1, 5.0),
    duration:    zbRange(h(3), cat.durLow, cat.durHigh),
    attack:      zbRange(h(4), 0.001, 0.1),
    decay:       zbRange(h(5), 0.01, 0.4),
    sustain:     zbRange(h(6), 0.0, 0.8),
    release:     zbRange(h(7), 0.01, 0.3),
    filterFreq:  zbRange(h(8), 100, 8000),
    filterQ:     zbRange(h(9), 0.1, 8.0),
    echoDelay:   zbRange(h(10), 0, 0.3),
    echoDecay:   zbRange(h(11), 0, 0.5),
    bitCrush:    zbInt(h(12), 2, 16),
    addNoise:    zbFloat(h(13)) > 0.7,
    noiseAmount: zbRange(h(14), 0.1, 0.5),
    arpeggio:    null,
    addBass:     zbFloat(h(15)) > 0.85,
    bassFreq:    zbRange(h(16), 25, 80),
  };
}

// ============================================================================
// SECTION 4: ZB AUDIO ENGINE
// Noise buffer: position-hashed, per-soundSeed, LRU-cached
// ============================================================================
class ZBEngine {
  constructor() {
    this.ctx         = null;
    this.masterGain  = null;
    this.analyser    = null;
    this._noiseCache = new Map();
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.masterGain.connect(this.analyser);
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  // ZeroByes noise: sample N depends ONLY on (N, soundSeed) — never on N-1
  _buildNoiseBuffer(soundSeed) {
    const sr  = this.ctx.sampleRate;
    const len = sr * 2;
    const buf = this.ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const h = zbHash(i, soundSeed ^ 0x5E5E5E5E);
      d[i] = ((h & 1) * 2 - 1) * 0.5; // 1-bit output, SPC700 authentic
    }
    return buf;
  }

  _getNoiseBuffer(soundSeed) {
    if (!this._noiseCache.has(soundSeed)) {
      if (this._noiseCache.size >= 8) {
        this._noiseCache.delete(this._noiseCache.keys().next().value);
      }
      this._noiseCache.set(soundSeed, this._buildNoiseBuffer(soundSeed));
    }
    return this._noiseCache.get(soundSeed);
  }

  _createBitCrusher(bits) {
    const steps = Math.pow(2, bits);
    const curve = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) {
      const x = (i / 32768) - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = curve;
    shaper.oversample = 'none';
    return shaper;
  }

  _createPulseWave(dutyCycle = 0.5) {
    const harmonics = 32;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);
    for (let n = 1; n < harmonics; n++) {
      imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * dutyCycle);
    }
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  play(params) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (params.arpeggio) {
      this._playArpeggio(params, now);
      return;
    }

    let source;
    if (params.waveform === 'noise') {
      source = this.ctx.createBufferSource();
      source.buffer = this._getNoiseBuffer(params.soundSeed || 0);
      source.loop = true;
    } else {
      source = this.ctx.createOscillator();
      if (params.waveform === 'square') {
        source.setPeriodicWave(this._createPulseWave(0.5));
      } else {
        source.type = params.waveform;
      }
      source.frequency.setValueAtTime(params.baseFreq, now);
      if (params.freqSweep !== 1) {
        source.frequency.exponentialRampToValueAtTime(
          Math.max(1, params.baseFreq * params.freqSweep),
          now + params.duration
        );
      }
    }

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(params.filterFreq, now);
    filter.Q.value = params.filterQ;

    const crusher = this._createBitCrusher(params.bitCrush || 8);

    const gaussFilter = this.ctx.createBiquadFilter();
    gaussFilter.type = 'lowpass';
    gaussFilter.frequency.value = 16000;
    gaussFilter.Q.value = 0.5;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.8, now + params.attack);
    env.gain.setTargetAtTime(params.sustain * 0.8, now + params.attack, params.decay / 3);
    env.gain.setTargetAtTime(0.0001, now + params.duration - params.release, params.release / 3);

    source.connect(filter);
    filter.connect(crusher);
    crusher.connect(gaussFilter);
    gaussFilter.connect(env);

    // Noise layer
    if (params.addNoise && params.noiseAmount) {
      const noiseS = this.ctx.createBufferSource();
      noiseS.buffer = this._getNoiseBuffer((params.soundSeed || 0) ^ 0xABCD1234);
      noiseS.loop = true;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(params.noiseAmount * 0.5, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + params.duration);
      const nf = this.ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = params.baseFreq * 2;
      nf.Q.value = 1;
      noiseS.connect(nf);
      nf.connect(ng);
      ng.connect(env);
      noiseS.start(now);
      noiseS.stop(now + params.duration + 0.1);
    }

    // Bass layer for explosions
    if (params.addBass && params.bassFreq) {
      const bass = this.ctx.createOscillator();
      bass.type = 'sine';
      bass.frequency.setValueAtTime(params.bassFreq, now);
      bass.frequency.exponentialRampToValueAtTime(20, now + params.duration * 0.7);
      const bg = this.ctx.createGain();
      bg.gain.setValueAtTime(0.6, now);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + params.duration * 0.8);
      bass.connect(bg);
      bg.connect(this.masterGain);
      bass.start(now);
      bass.stop(now + params.duration + 0.1);
    }

    // Echo
    if (params.echoDelay > 0 && params.echoDecay > 0) {
      const delay    = this.ctx.createDelay(1);
      delay.delayTime.value = params.echoDelay;
      const feedback = this.ctx.createGain();
      feedback.gain.value = params.echoDecay;
      const wetGain  = this.ctx.createGain();
      wetGain.gain.value = 0.4;
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wetGain);
      env.connect(delay);
      wetGain.connect(this.masterGain);
    }

    env.connect(this.masterGain);
    source.start(now);
    source.stop(now + params.duration + 0.1);
  }

  _playArpeggio(params, now) {
    // Each note derived from its own index hash — no sequential dependency
    const { notes, speed } = params.arpeggio;
    notes.forEach((freq, i) => {
      // Note time derived from index directly (O(1), no prior note dependency)
      const noteTime = now + i * speed;
      const osc = this.ctx.createOscillator();
      osc.type = params.waveform === 'noise' ? 'square' : params.waveform;
      osc.frequency.setValueAtTime(freq, noteTime);

      const crusher = this._createBitCrusher(params.bitCrush || 10);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, noteTime);
      env.gain.linearRampToValueAtTime(0.6, noteTime + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, noteTime + speed * 0.9);

      osc.connect(crusher);
      crusher.connect(env);
      env.connect(this.masterGain);
      osc.start(noteTime);
      osc.stop(noteTime + speed + 0.05);
    });
  }

  setVolume(v) {
    if (this.masterGain) this.masterGain.gain.value = v;
  }
}

// ============================================================================
// SECTION 5: DETERMINISM VERIFICATION
// ============================================================================
export function zbVerifyAll(worldSeed = 0x1337BEEF) {
  const results = {};
  Object.keys(ZB_SOUNDS).forEach(name => {
    const a = zbDeriveParams(name, worldSeed);
    const b = zbDeriveParams(name, worldSeed);
    const keys = Object.keys(a).filter(k => k !== 'soundSeed');
    const mismatches = keys.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    results[name] = mismatches.length === 0 ? '✓' : `✗ (${mismatches.join(',')})`;
  });
  return results;
}

// ============================================================================
// SECTION 6: REACT COMPONENT
// ============================================================================
const CATEGORY_ORDER = ['movement','pickup','combat','explosion','ui','power','damage','environment'];

export default function ZeroSounds() {
  const engineRef         = useRef(null);
  const [worldSeed, setWorldSeed]   = useState(0x1337BEEF);
  const [randomSeed, setRandomSeed] = useState(0);
  const [activeSound, setActiveSound] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [volume, setVolume]         = useState(0.55);
  const [showVerify, setShowVerify] = useState(false);
  const [verifyResults, setVerifyResults] = useState(null);
  const [showParams, setShowParams] = useState(false);
  const [activeParams, setActiveParams] = useState(null);

  // Get engine (lazy init)
  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new ZBEngine();
    return engineRef.current;
  };

  // Derive all preset params from worldSeed — recomputed only when worldSeed changes
  const derivedPresets = useMemo(() => {
    return Object.fromEntries(
      Object.keys(ZB_SOUNDS).map(name => [name, zbDeriveParams(name, worldSeed)])
    );
  }, [worldSeed]);

  // Random patch — deterministic from randomSeed
  const randomParams = useMemo(() => {
    if (randomSeed === 0) return null;
    return zbRandomize(randomSeed, worldSeed);
  }, [randomSeed, worldSeed]);

  const playSound = useCallback((name, params) => {
    const eng = getEngine();
    eng.init();
    eng.resume();
    eng.play(params);
    setActiveSound(name);
    setActiveParams(params);
    setTimeout(() => setActiveSound(s => s === name ? null : s), 300);
  }, []);

  const playPreset = useCallback((name) => {
    playSound(name, derivedPresets[name]);
  }, [derivedPresets, playSound]);

  const handleRandomize = () => {
    const next = randomSeed + 1;
    setRandomSeed(next);
    const p = zbRandomize(next, worldSeed);
    playSound(`rnd:${next}`, p);
  };

  const handleVerify = () => {
    const results = zbVerifyAll(worldSeed);
    setVerifyResults(results);
    setShowVerify(true);
  };

  const handleVolumeChange = (v) => {
    setVolume(v);
    if (engineRef.current) engineRef.current.setVolume(v);
  };

  const filteredSounds = Object.entries(ZB_SOUNDS).filter(
    ([, s]) => activeCategory === 'all' || s.category === activeCategory
  );

  const seedHex = '0x' + (worldSeed >>> 0).toString(16).toUpperCase().padStart(8, '0');

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <h1 style={styles.title}>ZERO<span style={styles.titleAccent}>SOUNDS</span></h1>
            <p style={styles.subtitle}>ZeroByes · position-is-seed · deterministic synthesis</p>
          </div>
          <div style={styles.seedDisplay}>
            <div style={styles.seedLabel}>WORLD SEED</div>
            <div style={styles.seedValue}>{seedHex}</div>
          </div>
        </div>
      </header>

      <div style={styles.layout}>
        {/* Left column: controls */}
        <aside style={styles.sidebar}>
          {/* World Seed */}
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>
              <span style={styles.dot('#a78bfa')} />
              World Seed
            </h2>
            <p style={styles.hint}>Shift the entire library coherently. One value → 33 sounds morph.</p>
            <input
              type="range"
              min={0}
              max={0xFFFFFFFF}
              step={1337}
              value={worldSeed}
              onChange={e => setWorldSeed(Number(e.target.value))}
              style={styles.slider}
            />
            <div style={styles.seedRow}>
              <input
                type="text"
                value={seedHex}
                onChange={e => {
                  const v = parseInt(e.target.value, 16);
                  if (!isNaN(v)) setWorldSeed(v >>> 0);
                }}
                style={styles.seedInput}
                spellCheck={false}
              />
              <button
                onClick={() => setWorldSeed(zbHash(Date.now() & 0xFFFFFFFF, 0x42))}
                style={styles.btnSmall}
              >
                RND
              </button>
            </div>
          </section>

          {/* Volume */}
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>
              <span style={styles.dot('#34d399')} />
              Volume
            </h2>
            <input
              type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => handleVolumeChange(Number(e.target.value))}
              style={styles.slider}
            />
            <div style={styles.paramVal}>{Math.round(volume * 100)}%</div>
          </section>

          {/* Deterministic Randomize */}
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>
              <span style={styles.dot('#fb923c')} />
              Infinite Patch Space
            </h2>
            <p style={styles.hint}>
              No Math.random() — every patch is a deterministic position in hash-space.
            </p>
            <button onClick={handleRandomize} style={styles.btnPrimary}>
              ◈ NEXT PATCH [{randomSeed}]
            </button>
            {randomParams && (
              <div style={styles.patchInfo}>
                <div style={styles.patchRow}>
                  <span>Seed</span>
                  <span style={styles.patchVal}>
                    0x{(randomParams.soundSeed >>> 0).toString(16).toUpperCase()}
                  </span>
                </div>
                <div style={styles.patchRow}>
                  <span>Wave</span>
                  <span style={styles.patchVal}>{randomParams.waveform}</span>
                </div>
                <div style={styles.patchRow}>
                  <span>Freq</span>
                  <span style={styles.patchVal}>{Math.round(randomParams.baseFreq)} Hz</span>
                </div>
                <div style={styles.patchRow}>
                  <span>Bits</span>
                  <span style={styles.patchVal}>{randomParams.bitCrush}-bit</span>
                </div>
              </div>
            )}
          </section>

          {/* Verify */}
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>
              <span style={styles.dot('#60a5fa')} />
              ZB Compliance Test
            </h2>
            <p style={styles.hint}>Run determinism verification across all 33 sounds.</p>
            <button onClick={handleVerify} style={{ ...styles.btnPrimary, background: '#1e3a5f' }}>
              ▶ RUN VERIFY
            </button>
            {showVerify && verifyResults && (
              <div style={styles.verifyGrid}>
                {Object.entries(verifyResults).map(([name, result]) => (
                  <div key={name} style={styles.verifyRow}>
                    <span style={{ opacity: 0.7, fontSize: '10px' }}>{name}</span>
                    <span style={{ color: result === '✓' ? '#34d399' : '#ef4444' }}>{result}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Active Params */}
          {showParams && activeParams && (
            <section style={styles.panel}>
              <h2 style={styles.panelTitle}>
                <span style={styles.dot('#f472b6')} />
                Last Derived Params
              </h2>
              <div style={styles.paramDump}>
                {Object.entries(activeParams)
                  .filter(([k]) => !['arpeggio', 'soundSeed'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} style={styles.paramRow}>
                      <span style={{ color: '#94a3b8' }}>{k}</span>
                      <span style={{ color: '#e2e8f0' }}>
                        {typeof v === 'number' ? v.toFixed(3) : String(v)}
                      </span>
                    </div>
                  ))}
                {activeParams.arpeggio && (
                  <div style={styles.paramRow}>
                    <span style={{ color: '#94a3b8' }}>arp.notes</span>
                    <span style={{ color: '#e2e8f0', fontSize: '9px' }}>
                      [{activeParams.arpeggio.notes.map(n => Math.round(n)).join(', ')}]
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          <button
            onClick={() => setShowParams(p => !p)}
            style={{ ...styles.btnSmall, width: '100%', marginTop: '4px' }}
          >
            {showParams ? '▲ HIDE PARAMS' : '▼ SHOW PARAMS'}
          </button>
        </aside>

        {/* Main: sound grid */}
        <main style={styles.main}>
          {/* Category filter */}
          <div style={styles.catBar}>
            {['all', ...CATEGORY_ORDER].map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  ...styles.catBtn,
                  ...(activeCategory === cat ? styles.catBtnActive : {}),
                  ...(cat !== 'all' ? { borderColor: CATEGORY_COLORS[cat] + '88' } : {}),
                  ...(activeCategory === cat && cat !== 'all'
                    ? { background: CATEGORY_COLORS[cat] + '22', borderColor: CATEGORY_COLORS[cat] }
                    : {}),
                }}
              >
                {cat.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Sound buttons grid */}
          <div style={styles.soundGrid}>
            {filteredSounds.map(([name, soundDef]) => {
              const color  = CATEGORY_COLORS[soundDef.category];
              const params = derivedPresets[name];
              const isActive = activeSound === name;
              return (
                <button
                  key={name}
                  onClick={() => playPreset(name)}
                  style={{
                    ...styles.soundBtn,
                    borderColor: isActive ? color : color + '44',
                    background: isActive
                      ? color + '33'
                      : 'rgba(15, 23, 42, 0.6)',
                    boxShadow: isActive ? `0 0 20px ${color}55` : 'none',
                    transform: isActive ? 'scale(0.96)' : 'scale(1)',
                  }}
                >
                  <div style={{ ...styles.soundLabel, color: isActive ? color : '#e2e8f0' }}>
                    {soundDef.label}
                  </div>
                  <div style={styles.soundMeta}>
                    <span style={{ color: color + 'bb' }}>{soundDef.category}</span>
                    <span style={{ color: '#475569' }}>
                      {Math.round(params.baseFreq)}Hz
                    </span>
                  </div>
                  <div style={styles.soundWave}>
                    <span style={{ color: '#475569' }}>{params.waveform}</span>
                    <span style={{ color: '#334155' }}>{params.bitCrush}bit</span>
                  </div>
                  {params.arpeggio && (
                    <div style={{ ...styles.badge, background: color + '33', color }}>ARP</div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ZB Laws reference */}
          <div style={styles.lawsGrid}>
            {[
              ['O(1) Access', 'Any param derived directly — no iteration'],
              ['Parallelism', 'Each param hashes independently'],
              ['Coherence',   'Adjacent sounds share category seed'],
              ['Hierarchy',   'world→cat→sound→param→sample'],
              ['Determinism', 'Same seed = same sound, always'],
            ].map(([law, desc]) => (
              <div key={law} style={styles.lawCard}>
                <div style={styles.lawName}>{law}</div>
                <div style={styles.lawDesc}>{desc}</div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = {
  root: {
    background: '#0a0f1e',
    minHeight: '100vh',
    fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
    color: '#e2e8f0',
    boxSizing: 'border-box',
  },
  header: {
    background: 'linear-gradient(90deg, #0f172a 0%, #1e293b 100%)',
    borderBottom: '1px solid #1e293b',
    padding: '16px 24px',
  },
  headerInner: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    margin: 0,
    fontSize: '28px',
    fontWeight: '900',
    letterSpacing: '4px',
    color: '#f1f5f9',
  },
  titleAccent: {
    color: '#a78bfa',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: '10px',
    color: '#475569',
    letterSpacing: '2px',
  },
  seedDisplay: {
    textAlign: 'right',
  },
  seedLabel: {
    fontSize: '9px',
    color: '#475569',
    letterSpacing: '2px',
    marginBottom: '2px',
  },
  seedValue: {
    fontFamily: 'monospace',
    fontSize: '18px',
    color: '#a78bfa',
    letterSpacing: '2px',
  },
  layout: {
    display: 'flex',
    gap: '0',
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  sidebar: {
    width: '280px',
    flexShrink: 0,
    padding: '16px',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  panel: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '6px',
    padding: '14px',
  },
  panelTitle: {
    margin: '0 0 10px',
    fontSize: '10px',
    letterSpacing: '2px',
    color: '#94a3b8',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  dot: (color) => ({
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
  hint: {
    margin: '0 0 10px',
    fontSize: '9px',
    color: '#475569',
    lineHeight: '1.5',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
    accentColor: '#a78bfa',
  },
  paramVal: {
    fontSize: '10px',
    color: '#64748b',
    marginTop: '4px',
    textAlign: 'right',
  },
  seedRow: {
    display: 'flex',
    gap: '6px',
    marginTop: '8px',
  },
  seedInput: {
    flex: 1,
    background: '#0a0f1e',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: '#a78bfa',
    fontFamily: 'monospace',
    fontSize: '11px',
    padding: '6px 8px',
    outline: 'none',
  },
  btnSmall: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '4px',
    color: '#94a3b8',
    fontFamily: 'inherit',
    fontSize: '9px',
    padding: '6px 10px',
    cursor: 'pointer',
    letterSpacing: '1px',
  },
  btnPrimary: {
    width: '100%',
    background: '#2d1b69',
    border: '1px solid #7c3aed',
    borderRadius: '4px',
    color: '#c4b5fd',
    fontFamily: 'inherit',
    fontSize: '10px',
    padding: '10px',
    cursor: 'pointer',
    letterSpacing: '2px',
    transition: 'all 0.1s',
  },
  patchInfo: {
    marginTop: '10px',
    background: '#0a0f1e',
    border: '1px solid #1e293b',
    borderRadius: '4px',
    padding: '8px',
  },
  patchRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '9px',
    color: '#475569',
    marginBottom: '3px',
  },
  patchVal: {
    color: '#a78bfa',
    fontFamily: 'monospace',
  },
  verifyGrid: {
    marginTop: '10px',
    maxHeight: '160px',
    overflowY: 'auto',
    background: '#0a0f1e',
    border: '1px solid #1e293b',
    borderRadius: '4px',
    padding: '8px',
  },
  verifyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '9px',
    marginBottom: '3px',
  },
  paramDump: {
    background: '#0a0f1e',
    borderRadius: '4px',
    padding: '8px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  paramRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '9px',
    marginBottom: '3px',
  },
  main: {
    flex: 1,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  catBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  catBtn: {
    background: 'transparent',
    border: '1px solid #1e293b',
    borderRadius: '4px',
    color: '#64748b',
    fontFamily: 'inherit',
    fontSize: '8px',
    padding: '5px 10px',
    cursor: 'pointer',
    letterSpacing: '1px',
    transition: 'all 0.1s',
  },
  catBtnActive: {
    color: '#e2e8f0',
    background: '#1e293b',
  },
  soundGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '8px',
  },
  soundBtn: {
    background: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid',
    borderRadius: '6px',
    padding: '12px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    position: 'relative',
    transition: 'all 0.08s ease',
    fontFamily: 'inherit',
  },
  soundLabel: {
    fontSize: '11px',
    fontWeight: '700',
    display: 'block',
    marginBottom: '6px',
    letterSpacing: '0.5px',
  },
  soundMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '8px',
    marginBottom: '2px',
  },
  soundWave: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '8px',
  },
  badge: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    fontSize: '7px',
    padding: '2px 4px',
    borderRadius: '2px',
    letterSpacing: '1px',
  },
  lawsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '8px',
    marginTop: 'auto',
  },
  lawCard: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '6px',
    padding: '10px',
  },
  lawName: {
    fontSize: '9px',
    color: '#a78bfa',
    letterSpacing: '1px',
    marginBottom: '4px',
    fontWeight: '700',
  },
  lawDesc: {
    fontSize: '8px',
    color: '#475569',
    lineHeight: '1.4',
  },
};
