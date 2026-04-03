# ZeroSounds-JSX

**Deterministic SNES-style audio synthesis for games and applications.**

ZeroSounds is a React component and audio engine built on the [ZeroByes](https://github.com/MushroomFleet/) methodology — *position-is-seed, zero bytes store infinity*. Every sound parameter is derived O(1) from a hash of `(soundName, worldSeed)`. No `Math.random()`. No hardcoded preset objects. No stored state.

One 32-bit integer seeds an entire sound library. Share that integer, and anyone anywhere reproduces your exact sounds.

---

## 🎮 Live Demo

**[→ Try the interactive demo at scuffedepoch.com/zero-sounds/](https://scuffedepoch.com/zero-sounds/)**

The demo requires no installation — open it in any modern browser and start exploring. Drag the **World Seed** slider to morph all 33 sounds simultaneously, run the built-in ZeroByes compliance verifier, and inspect every derived parameter in real time.

---

## Why ZeroSounds?

Most game audio systems store sounds as fully-specified preset objects. Add a new sound, write 15 fields. Want to theme-shift your library? Edit every preset by hand. Randomize a patch? Hope you don't need to reproduce it later.

ZeroSounds inverts this. The sound *is* the seed.

| Feature | Traditional approach | ZeroSounds |
|---|---|---|
| Sound library size | Fixed — however many presets you wrote | Infinite — any 32-bit seed |
| Randomize reproducibility | None (`Math.random()`) | Full — share a single integer |
| Noise texture | One global buffer, generated once | Per-sound, deterministic, O(1) by sample index |
| World theming | Edit every preset manually | One slider — all sounds morph coherently |
| Adding a new sound | Write 15+ field object | Add a 3-field entry to `ZB_SOUNDS` |
| Cross-session patch sharing | Serialise the entire params object | Share one number |
| Storage required | ~450 lines of preset data | 0 bytes — derived at runtime |

---

## The Five ZeroByes Laws (Audio Edition)

| Law | Audio Meaning |
|---|---|
| **O(1) Access** | Any parameter is derivable directly from `(soundId, sampleIndex, worldSeed)` — no prior states needed |
| **Parallelism** | Each parameter hashes from its own slot `k` — no cross-parameter dependencies |
| **Coherence** | Adjacent sounds share a category seed — movement sounds stay movement-like across world seeds |
| **Hierarchy** | `worldSeed → categorySeed → soundSeed → paramSeed[k] → sampleSeed[n]` |
| **Determinism** | Same `(soundId, worldSeed)` → identical synthesis parameters on every machine, every session |

---

## Quickstart

### Using the component in a React project

```bash
# Copy ZeroSounds.jsx into your project — no package dependencies required
cp ZeroSounds.jsx src/components/
```

```jsx
import ZeroSounds from './components/ZeroSounds';

export default function App() {
  return <ZeroSounds />;
}
```

### Using the engine directly in your game

The audio engine and hash core are self-contained and can be extracted from `ZeroSounds.jsx` for use without React.

```js
import { zbHash, zbFloat, zbRange, zbInt, zbDeriveParams, zbVerifyAll } from './ZeroSounds';

// Derive parameters for any sound at any world seed — O(1)
const params = zbDeriveParams('explosion', 0xDEADBEEF);
// → { waveform: 'noise', baseFreq: 74.3, bitCrush: 4, addBass: true, ... }

// The same call on any machine at any time returns identical params
const same   = zbDeriveParams('explosion', 0xDEADBEEF);
// → identical object
```

### Embedding the standalone demo

`demo.html` is fully self-contained — no build step, no server, no dependencies. Drop it anywhere:

```html
<!-- Serve locally -->
python3 -m http.server

<!-- Or just open the file directly in a browser -->
open demo.html
```

---

## Integration Guide

### Game engine integration

ZeroSounds is designed to slot into any game's audio layer. The core pattern: your game holds one `worldSeed` integer. Pass it alongside the sound name whenever an event fires.

```js
// On player jump:
const params = zbDeriveParams('jump', game.worldSeed);
engine.play(params);

// On enemy hit — same world, same results:
const params = zbDeriveParams('enemyHit', game.worldSeed);
engine.play(params);
```

**World seed as a game variable.** Because the entire sound library derives from `worldSeed`, you can tie it to game state for free audio reactivity:

```js
// Sounds grow darker and harsher as the player descends
const depthSeed = zbHash(player.depth, baseSeed);
const params    = zbDeriveParams('footstep', depthSeed);
engine.play(params);

// Boss encounter: one seed value shifts the entire audio palette
const bossSeed = zbHash(bossId, worldSeed);
```

### Procedural sound events

Use `zbRandomize(counter, worldSeed)` for events that need variety but must be reproducible (e.g., networked multiplayer):

```js
// Each collected item plays a unique sound,
// but every client derives the same patch from the item's id
const params = zbRandomize(item.id, worldSeed);
engine.play(params);
```

### Zero-Temporal extension

Derive ADSR shape from `(soundId, gameClock)` to evolve sounds over world time without storing state:

```js
// Footstep character changes as hours pass in the game world — no state stored
const timeSeed = zbHash(Math.floor(gameClock / 3600), zbHash('footstep', worldSeed));
const params   = zbDeriveParams('footstep', timeSeed);
```

### Zero-Quadratic extension

Derive echo and reverb from the *pair* `(soundId, environmentId)` for free environment-aware acoustics:

```js
// Same explosion sounds different indoors vs outdoors
const envSeed = zbHash(environmentId, zbHash('explosion', worldSeed));
const params  = zbDeriveParams('explosion', envSeed);
```

---

## Sound Library

33 named sounds across 8 categories. Each is a 3-field anchor — not a preset. Parameters are derived at call time.

| Category | Sounds |
|---|---|
| **movement** | jump, doubleJump, dash, land |
| **pickup** | coin, gem, heart, key |
| **combat** | laser, blaster, sword, punch, magicSpell |
| **explosion** | explosion, smallExplosion, boom |
| **ui** | menuSelect, menuConfirm, menuCancel, pause, textBlip |
| **power** | powerUp, levelUp, oneUp, heal |
| **damage** | hurt, death, enemyHit, warning |
| **environment** | doorOpen, chest, splash, teleport, footstep |

### Adding a new sound

```js
// In ZB_SOUNDS — that's it. No params to specify.
myNewSound: { category: 'combat', style: 0, styleIndex: 5, label: '🗡 Stab' },
```

The derivation function handles the rest. Style `0` = tonal, `1` = noisy, `2` = arpeggio. Category sets the frequency and duration bounds.

---

## API Reference

### Hash Core

```js
zbHash(key, seed)           // → u32   Murmur3-mix, platform-safe
zbFloat(hash)               // → [0,1) float from hash
zbRange(hash, min, max)     // → float in [min, max]
zbInt(hash, min, max)       // → integer in [min, max]
```

### Parameter Derivation

```js
zbDeriveParams(soundName, worldSeed)
// → { waveform, baseFreq, freqSweep, duration, attack, decay, sustain,
//     release, filterFreq, filterQ, echoDelay, echoDecay, bitCrush,
//     arpeggio, addNoise, noiseAmount, addBass, bassFreq, soundSeed }

zbRandomize(numericSeed, worldSeed)
// → same shape as zbDeriveParams — an unnamed sound at position numericSeed
```

### Verification

```js
zbVerifyAll(worldSeed)
// → { soundName: '✓' | '✗ (field, ...)' }
// Runs every sound through zbDeriveParams twice and diffs results
// All 33 should return '✓' — if not, a platform hash has crept in somewhere
```

### ZBEngine (audio playback)

```js
const engine = new ZBEngine();
engine.init();              // creates AudioContext (call after user gesture)
engine.play(params);        // plays a derived params object
engine.setVolume(0.0–1.0);  // adjusts master gain
```

---

## ZeroByes Compliance

The hash core uses a Murmur3 finaliser mix implemented with `Math.imul()` — the only integer multiplication primitive that is guaranteed identical across all JavaScript engines. No `Math.random()`. No `Date.now()` seeds. No LFSR sequential state.

Run verification at startup to confirm your build is clean:

```js
import { zbVerifyAll } from './ZeroSounds';

// At app start — all should log ✓
const results = zbVerifyAll(0x1337BEEF);
console.table(results);
```

---

## Files

```
ZeroSounds-JSX/
├── ZeroSounds.jsx      # React component + ZBEngine + full hash core
├── demo.html           # Self-contained interactive demo — no build required
└── README.md
```

---

## 📚 Citation

### Academic Citation

If you use this codebase in your research or project, please cite:

```bibtex
@software{zerosounds_jsx,
  title  = {ZeroSounds-JSX: ZeroByes-Aligned Deterministic SNES-Style Audio Synthesis},
  author = {Drift Johnson},
  year   = {2025},
  url    = {https://github.com/MushroomFleet/ZeroSounds-JSX},
  version = {1.0.0}
}
```

### Donate

[![Ko-Fi](https://cdn.ko-fi.com/cdn/kofi3.png?v=3)](https://ko-fi.com/driftjohnson)
