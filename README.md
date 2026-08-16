# Memory Master

A polished single-page memory card game — glass morphism UI, neon accents, animated
particle background, 70 levels, coins, a store and power-ups. No build step, no
dependencies, no bundler.

## Running it

ES modules are blocked by browser CORS rules over `file://`, so the game **must be
served over HTTP**. Opening `index.html` by double-clicking it will show a blank page.

```bash
# any one of these, from the project root:
python -m http.server 8765
npx serve .
npx http-server -p 8765
```

Then open <http://127.0.0.1:8765>.

## Folder structure

```
index.html              Single page shell: header, screen containers, overlays
css/
  style.css             All styling: theme tokens, glass, neon, responsive
js/
  main.js               Bootstrap — wires storage, header, router, particles, pause
  core/
    game.js             Engine: GameManager, GameBoard, Card (no DOM)
    levels.js           70 level definitions + the 3-star rating maths
    coins.js            Coin payout formula and the persistent coin bank
    router.js           SPA router; lazy-loads screens with dynamic import()
    storage.js          localStorage save file: player, progress, coins
    events.js           EventBus (EventTarget) + EVENTS name table
  data/
    themes.js           12 emoji symbol sets (24 symbols each) + random selection
    store-items.js      Card backs, store catalogue, power-up metadata
  screens/
    menu.js             Neon title, Play / Store / Settings, settings modal
    level-select.js     70 levels in five difficulty bands: locks, gates, best time, stars
    gameplay.js         Board rendering, driven entirely by engine events
    store.js            Tabbed shop: card backs, themes, power-ups, Coming Soon
    win.js              Result screen: star reveal, coin breakdown, next level
  ui/
    header.js           Coins / level / timer / moves + nav buttons
    timer-ring.js       Circular corner countdown, green → red as time drains
    particles.js        Canvas floating-particle background
    audio.js            Synthesised WebAudio engine: two buses, limiter, reverb
    toast.js            Transient messages
    effects.js          Confetti, combo flashes, coin flight, match sparks
tools/                  Dev-only verification scripts (not shipped)
```

## Architecture

**Single page, no reloads.** `index.html` holds one `<section>` per screen. The router
swaps screens by lazily `import()`-ing the screen module, calling `render(params)` for
markup and `mount(el, params, router)` for behaviour, then `unmount()` on exit. The URL
hash (`#/menu`, `#/game`) keeps the back button working.

**Event-driven engine.** `GameManager` extends an `EventBus` and never touches the DOM.
It emits `game:init`, `card:flip`, `game:timer-start`, `pair:match`, `pair:mismatch`,
`card:unflip`, `game:tick`, `game:over` and friends; `screens/gameplay.js` subscribes
and translates each payload into DOM changes. Swapping the renderer would not require
touching game rules.

**Screen module contract.**

```js
export default {
  title:  'Store',
  header: { show: true, home: true, pause: false, timer: false, moves: false, level: true },
  render(params) { return '<html string>'; },
  mount(el, params, router) {},
  unmount(el) {},
};
```

## Levels

70 levels in ten grid tiers. The time budget **tightens with every level inside a tier**,
then steps back up when the grid grows — a literal countdown across all 70 would make the
24-pair board unwinnable. Every level still allows at least 5 seconds per pair.

| Levels | Grid | Pairs | Time     | Difficulty  |
| ------ | ---- | ----- | -------- | ----------- |
| 1–3    | 2×2  | 2     | 30→20s   | easy        |
| 4–6    | 2×3  | 3     | 42→30s   | easy        |
| 7–10   | 4×3  | 6     | 78→56s   | medium      |
| 11–15  | 4×4  | 8     | 104→74s  | medium/hard |
| 16–18  | 4×5  | 10    | 124→100s | hard        |
| 19–20  | 6×5  | 15    | 175→158s | expert      |
| 21–32  | 4×8  | 16    | 150→84s  | expert      |
| 33–44  | 6×6  | 18    | 168→102s | expert      |
| 45–56  | 5×8  | 20    | 190→124s | master      |
| 57–70  | 6×8  | 24    | 230→152s | master      |

The four tiers past level 20 only ever climb: each holds more pairs than the 15 of levels
19–20, so the ladder never revisits a smaller board. Their clocks come from `ramp(from,
count)` — one budget per level, six seconds off each step — rather than being spelled out.

Each level also carries a `requiredCoins` **balance gate** — a minimum you must be
holding to enter, never spent — and a fallback theme used when no random one is drawn.
Levels 1–20 gate from 0 up to 🪙1000; past that the curve is a steady 60 coins per level,
🪙1100 at level 21 rising to 🪙4040 at level 70. A single clear on those boards pays several
times the 60-coin step, so the gate never turns into a grind. Grids re-orient to portrait
on phones so cards stay large, and the 24-pair boards scroll inside the board area rather
than shrinking their cards past the point of being readable.

## Cards and matching

- **Front** is the face-down side: a woven-pattern gradient with a `?` and a small card-back
  badge. **Back** is the emoji. The 3D flip runs **0.6s** on `preserve-3d` with a slight
  settle overshoot.
- **Match** — both cards bounce, hold a breathing green glow, and throw a ring of sparks
  from the midpoint of the pair; the burst grows with the combo (capped at 24 sparks).
- **Mismatch** — a red shake on both cards plus a shake of the whole board, then the pair
  flips back after **1 second**. The board is locked throughout, so nothing can be clicked
  mid-animation.
- **Combos** — consecutive matches multiply the score (100 × combo), rise in pitch, and pop
  a `Combo ×N` flash over the board.
- **Hover** lifts an unflipped card by 6px, scales it 1.04 and sweeps a shine across it.

Every decorative animation — sparks, confetti, coin flight, particles, the barber-pole
banner — is skipped under `prefers-reduced-motion`.

## Timer

The countdown **starts on the first card flip**, not when the board appears, so reading the
grid costs nothing. It renders as a circular SVG ring in the corner of the board, draining
clockwise from 12 o'clock and shifting green → amber → orange → red; the last stretch
pulses. At zero the round ends on the **Game Over** screen with Retry Level / Level Select
/ Main Menu.

## Themes

12 emoji sets, 24 symbols each: fruits, animals, space, food, sports, tech, transport,
nature, weather, music, shapes and flags. 24 is the floor, not a round number — the 6×8
boards need 24 distinct symbols, and a set any shorter would have to repeat one and hand
the player two identical-looking pairs. A level draws a **random theme each round** by
default (the free "Surprise Me" store option), weighted so easy levels stay gentle and
expert levels can pull the trickier lookalike sets. Equipping a specific theme in the
store pins it instead.

## Stars

Three independent tests, so a fast-but-sloppy clear and a slow-but-tidy clear both land
on two stars:

| Star | Earned for                                      |
| ---- | ----------------------------------------------- |
| ★ 1  | Clearing the board at all                        |
| ★ 2  | Finishing in **under half** the level's time limit |
| ★ 3  | Finishing in **fewer than 2 × pairs** moves      |

Both thresholds are strict: exactly half the clock, or exactly `2 × pairs` moves, misses.
The win screen reveals the stars one at a time (260ms apart, each with its own chime and a
breathing gold glow) and then lists **every** criterion — met or missed, with the number you
needed — so a missing star is never a guess.

## Coins

```
10  base, for clearing the level
 5  per whole second left on the clock
 2  per combo match (every match after the first in an unbroken run)
```

A loss pays nothing. Hard mode adds **+25% on the sum of the three above**, computed
inside `calculateCoins()` as its own `bonus` line rather than by the caller — when the
gameplay screen multiplied the total afterwards, the win screen listed unboosted rows
under a boosted headline and the sum visibly disagreed. On a win the coins **fly from the
board to the header counter** along an arced path, and the counter tweens up as they land —
the balance itself is banked the instant it is earned, so leaving mid-flight can never lose
a payout. `core/coins.js` computes and banks; `ui/effects.js` owns the animation, keeping
`core/` free of DOM.

- **Power-ups** — Reveal (flash one matching pair), Freeze (stop the clock 10s),
  Shuffle (rearrange the unmatched cards). Each power-up is stocked in the store as a
  consumable bundle, and **every use also charges a coin fee from your live balance** on
  top of the stocked unit — a use requires *both* a unit in hand *and* the coins to pay:
  Reveal 🪙20, Freeze 🪙40, Shuffle 🪙30 (see the table below). A refusal (locked board,
  nothing left to reveal, short of coins or stock) burns neither the unit nor any coins.

  | Power-up | Stock bundle | Per-use fee | Effect                                   |
  | -------- | ------------ | ----------- | ---------------------------------------- |
  | Reveal   | 👁️ ×3 (🪙120) | 🪙 20       | Flash one matching pair for 1.5s         |
  | Freeze   | 🧊 ×2 (🪙150) | 🪙 40       | Stop the clock for 10s                   |
  | Shuffle  | 🔀 ×2 (🪙100) | 🪙 30       | Rearrange the still-unmatched cards      |

  Reveal shows the **partner of the card in your hand**, or one complete pair if your hands
  are empty — never the board. Holding one card, the only question worth answering is where
  its twin is; exposing everything would hand over the round rather than help with it.
  Reveal and Shuffle are both refused while a pair is mid-resolve: an unflip timer is
  holding two positions, and re-seating the deck under it leaves the wrong cards face-up.

## Store

Four tabs: **Card Backs** (5), **Themes** (12 plus the free random option), **Power-ups**
(restockable consumables — the card shows both the purchase price and the **per-use coin
fee** stacked beneath it) and **Coming Soon**.

`purchase()` never trusts its argument. It resolves the id against the catalogue and
charges the **catalogue's** price, so a fabricated item or a tampered price buys nothing —
pinned by tests, since the Coming Soon tab now renders cards that must stay unbuyable.

The **Coming Soon** tab retitles the screen "Store — Coming Soon" and shows an animated
barber-pole *Under Construction* banner over four greyed, dashed-border teasers — Premium
Themes, Card Skins, Power-ups+ and Remove Timer — each with a struck-through price, an ETA
and a `Coming Soon` tag. Clicking one explains why nothing happened rather than failing
silently. The teasers live in a separate `COMING_SOON` export, deliberately **not** in
`STORE_ITEMS`, so the purchase path cannot see them at all.

Below them a subscribe teaser takes an email address, validates its shape and records only
a boolean `notifyUpdates` setting. **The address itself is never stored or transmitted** —
there is no server in this project, and the tests assert no `fetch`/`sendBeacon` exists on
that path.

## Sound

`ui/audio.js` synthesises everything through WebAudio — no asset files, no network
requests. The context is created lazily on the first user gesture, since browsers block it
earlier, and suspends itself while the tab is hidden rather than holding the audio hardware
open in the background.

```
voices ──► sfxGain   ──┐
                       ├──► master ──► limiter ──► destination
melodies ─► musicGain ─┘        │
                 └──► reverbSend ──► convolver ──┘
```

Two buses, because a fanfare needs to duck the effects under it without touching the
player's master volume, and because the limiter should see one summed signal — a three-star
win fires star chimes, a coin run and a five-note melody inside the same 400ms, and that
stack clipped before the limiter existed. The reverb is a **convolver fed by a synthesised
impulse response** (two exponentially-decaying noise channels), so there is still no `.wav`
to ship; cues send to it in parallel, so the dry hit keeps its attack.

| Cue | Trigger |
| --- | --- |
| `flip` | card turns over (tone + a noise transient for the snap) |
| `match` / `combo(n)` | pair matched; pitch climbs with the combo |
| `mismatch` | wrong pair |
| `coin` | payout and purchases |
| `click` | buttons, tabs and the volume slider settling |
| `error` | rejected action |
| `hint` / `freeze` / `shuffle` | the three power-ups, each its own cue |
| `powerup` | fallback for a power-up with no dedicated sound |
| `tick` / `tock` | `countdown()` — alternating heartbeat under the last 10 seconds |
| `star` | `starEarned(n)` — one chime per star, each a fourth above the last |
| `unlock` | a level unlocked on a first clear |
| `levelComplete(stars)` | level cleared: 4-note rising melody, or the 5-note `perfect()` flourish at three stars |
| `gameOver()` | time ran out (3-note falling melody) |

Repeated cues are **detuned slightly on every trigger**. Flip fires up to sixty times a
round, and an identical sample at an identical pitch stops reading as a card and starts
reading as a beep; the deliberate ones (`error`, `coin`) stay fixed. Envelope attacks scale
with note duration for the same class of reason — a 45ms tick whose 12ms attack outlasted
its own decay held peak gain until the stop and came out as a click.

`audio.setVolume()` / `audio.volume` drive a **0–100 slider** in Settings and persist
through the save file; the level is ramped rather than stepped, since a jump on a live gain
node is audible. A save file written before the slider existed has no `volume` key, so a
missing value reads as **full volume** — never silence. `audio.setMuted()` /
`audio.toggleMute()` drive the **Sound effects** switch above it, which the slider follows
into a disabled state. Unmuting routes through the engine on purpose: it has to unlock the
audio context from inside the click gesture.

## Progress

Clearing a level unlocks the next one and writes the run to `localStorage` under
`memory-master:save:v2` — one save file holding the player record (`createdAt`,
`lastPlayed`, games played, best combo), the coin balance and lifetime earnings, per-level
best time / best stars / clear count, purchases and settings. Best records only ever
improve; a weaker replay leaves them alone.

**Level select** groups all 70 into five difficulty bands — Warm-up, Steady, Sharp, Expert
and Master — each with its own heading, level range, count and accent colour, and scrolls to
where you are up to. The bands are derived from each level's own `difficulty`, not from
hard-coded id ranges, so re-tiering a level in `core/levels.js` moves it between bands with
no second edit. Each card carries its number, grid size, difficulty, the coin balance the
level gates on (red when you are short), your best time and your stars. Locked levels are
greyed, desaturated and show a padlock.

**Win screen** reveals the stars, then time, moves and coins earned with the payout
itemised line by line, the score and best combo, a "Level N unlocked" pill and a note when
you have beaten your own record — then offers **Play Next Level**, Play Again, Level Select
or Main Menu. When the next level's coin gate is out of reach the button says what it wants
(`Level N needs 🪙 X`) instead of looking dead, and refuses the click — otherwise it would be
a way straight past the gate that level select enforces. Level 70 drops the next-level
button and shows an "every level cleared" line instead.

Keyboard: `Esc` / `P` pause, `M` main menu. The board auto-pauses if you switch tabs.

## Settings

Sound effects, a **0–100 volume slider** (inert while sound is off), background particles
and hard mode each toggle from the menu's Settings modal. Hard mode squeezes the clock to
**75%** of the level's budget — floored at 10 seconds, so no level can hand out an
unwinnable round — and pays **25% more coins**. The squeeze lives in the engine, not the
gameplay screen, so the star tests and the "time to spare" line both measure against the
clock the player actually got. The particle field and all animations also respect
`prefers-reduced-motion`.

## Verifying

`tools/` holds dev-only Node scripts (no dependencies):

```bash
# Windows-safe mirror (the project path has a space in it on this machine):
node tools/_build-win.mjs
# Generic mirror — pass an absolute mirror path on any platform:
node tools/_build-check.mjs js .mirror

node tools/_engine-test.mjs "$PWD/.mirror"        # 197 headless engine assertions
node tools/_hint-test.mjs "$PWD/.mirror"          #  15 hint reveals-exactly-the-right-cards assertions
node tools/_reveal-payload-test.mjs               #  16 pair/mismatch/unflip payload is 2 cards, never the board
node tools/_powerup-coin-test.mjs                #  37 per-use coin-fee assertions
node tools/_wiring-check.mjs .                    # 172 static wiring/CSS checks
```

The Windows mirror builder (`_build-win.mjs`) writes the `.mjs` copy into `./scratch-mmc`
and takes no arguments; the generic `_build-check.mjs` takes source and destination. Either
way, pass the mirror an **absolute** path to the test runners — they build `file://` URLs
from it, and a bare relative path resolves to a non-absolute URL on Windows.

The engine suite covers deck integrity on all 20 levels, the first-flip clock, the 1s
mismatch hold, combo scoring and combo-match counting, power-ups, the 3-star boundaries,
the coin formula (including part-second flooring and loss payouts), unlock progression,
coin-bank persistence across a reload, and that the Coming Soon teasers cannot be purchased
at any price. The **hint suite** pins the hint half of the old "revealing a pair reveals the
whole board" bug — `_hintTargets()` returns only the partner (1) or a single pair (2), never
the whole board, and the count is checked on untouched, one-card-held and last-pair boards.
The **reveal-payload suite** pins the other half, which lived in the event payloads: each
pair event was built as `{ cards: [first, second], ...snapshot() }`, and because `snapshot()`
also carries a `cards` key holding the *entire* board, the spread silently overwrote the
two-card array — so matching one pair told the renderer to mark every card matched, flipping
the whole board face up. The payloads now spread `snapshot()` **first** and set their own
keys after, and the suite asserts `pair:match`, `pair:mismatch` and `card:unflip` each carry
exactly two cards, across a full 8-pair clear and a full sweep of mismatches. The
**power-up coin suite** locks the per-use fee: a fire requires both a stocked unit and the
`useCost` coins, spends exactly one of each on success, and on any refusal (no funds, no
stock, or the engine refusing a locked board) burns neither. The wiring check verifies every
import, `EVENTS.*` key and referenced CSS class resolves, that `core/` stays DOM-free, that
the subscribe form sends nothing off-device, and that no entrance animation uses a fill-mode
that would defeat `:hover`. Layout, glow and animation are verified by code inspection and
these tests — there is no headless browser here, so no rendered-pixel check.

## Credits

Built with vanilla HTML, CSS and JavaScript — no frameworks, no build step, no
dependencies. Emoji artwork comes from the system font; every sound is synthesised at
runtime with the WebAudio API, so there are no asset files at all.

Made with ❤️ for the world

## License

Released under the [MIT License](LICENSE) — free to use, modify and share.
