# Memory Master

A polished single-page memory card game — glass morphism UI, neon accents, animated
particle background, 100 levels, coins, a store and power-ups. No build step, no
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
    levels.js           100 level definitions + the 3-star rating maths
    coins.js            Coin payout formula and the persistent coin bank
    router.js           SPA router; lazy-loads screens with dynamic import()
    storage.js          localStorage save file: player, progress, coins
    events.js           EventBus (EventTarget) + EVENTS name table
  data/
    themes.js           12 emoji symbol sets (32 symbols each) + random selection
    store-items.js      Card backs, store catalogue, power-up metadata
  screens/
    menu.js             Neon title, Play / Store / Settings, settings modal
    level-select.js     All 100 levels in six bands; locked tiles show a padlock
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

100 levels in twelve grid tiers. The time budget **tightens with every level inside a tier**,
then steps back up when the grid grows — a literal countdown across all 100 would make the
32-pair board unwinnable. Every level still allows at least 5 seconds per pair.

| Levels | Grid | Pairs | Time     | Difficulty    |
| ------ | ---- | ----- | -------- | ------------- |
| 1–3    | 2×2  | 2     | 30→20s   | easy          |
| 4–6    | 2×3  | 3     | 42→30s   | easy          |
| 7–10   | 4×3  | 6     | 78→56s   | medium        |
| 11–15  | 4×4  | 8     | 104→74s  | medium/hard   |
| 16–18  | 4×5  | 10    | 124→100s | hard          |
| 19–20  | 6×5  | 15    | 175→158s | expert        |
| 21–32  | 4×8  | 16    | 150→84s  | expert        |
| 33–44  | 6×6  | 18    | 168→102s | expert        |
| 45–56  | 5×8  | 20    | 190→124s | master        |
| 57–70  | 6×8  | 24    | 230→152s | master        |
| 71–80  | 7×8  | 28    | 210→165s | master        |
| 81–100 | 8×8  | 32    | 256→180s | grandmaster   |

The tiers past level 20 only ever climb: each holds more pairs than the 15 of levels
19–20, so the ladder never revisits a smaller board. Their clocks come from `ramp(from,
count, step)` — one budget per level, a fixed number of seconds off each step — rather than
being spelled out. The step shrinks as the boards grow (6s per level up to 70, then 5s and
4s), because a 28- or 32-pair tier draining at six seconds a level would fall through the
5-seconds-per-pair floor before the tier ended.

**Only level 1 is open on a fresh save.** Clearing a level unlocks the next one and nothing
else, so the ladder is walked in order; a cleared level stays open forever and can be
replayed for a better time or the star you missed. Nothing asks for a coin balance at the
door — coins are spent in the store and on power-up fees, and each level definition still
carries `requiredCoins`, pinned at `0`, plus a fallback theme used when no random one is
drawn. Grids re-orient to portrait on phones so cards stay large, and the biggest boards
scroll inside the board area rather than shrinking their cards past the point of being
readable.

The lock is a single decision in one place: `storage.canPlay(id)` answers with `ok` plus the
level that has to be cleared first, and the three doors into a round — the level-select
click, the board screen's own mount, and the win screen's next-level button — all ask it
rather than deciding for themselves. That matters because a level can be reached without
going through the list: a stale `#/game` hash, the back button after a reset, a hand-typed
URL. The board screen refuses those before dealing a board, so no clock starts and no coins
can be earned on a level that has not been reached.

A save file is **repaired rather than trusted** on load. `unlockedLevel` is clamped into
range, and then raised to one past the furthest level the save records as cleared — so a
file written while every level was open keeps everything it actually earned, and a corrupt
or hand-edited marker cannot lock a player out of their own progress. The repair only ever
hands access back; it never takes any away.

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

12 emoji sets, 32 symbols each: fruits, animals, space, food, sports, tech, transport,
nature, weather, music, shapes and flags. 32 is the floor, not a round number — the 8×8
boards need 32 distinct symbols, and a set any shorter would have to repeat one and hand
the player two identical-looking pairs. (`GameBoard.build()` cycles the symbol list, so a
short set fails silently rather than loudly — hence the test that pins the supply against
every level's pair count.) A level draws a **random theme each round** by default (the free
"Surprise Me" store option), weighted so easy levels stay gentle and expert, master and
grandmaster levels can pull the trickier lookalike sets. Equipping a specific theme in the
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
| `unlock` | reaching a new furthest level on a first clear |
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

Clearing a level advances the progress marker and writes the run to `localStorage` under
`memory-master:save:v2` — one save file holding the player record (`createdAt`,
`lastPlayed`, games played, best combo), the coin balance and lifetime earnings, per-level
best time / best stars / clear count, purchases and settings. Best records only ever
improve; a weaker replay leaves them alone, and clearing an earlier level never drags the
marker backwards.

**Level select** groups all 70 into five difficulty bands — Warm-up, Steady, Sharp, Expert
and Master — each with its own heading, level range, count and accent colour, and scrolls to
where you are up to. The bands are derived from each level's own `difficulty`, not from
hard-coded id ranges, so re-tiering a level in `core/levels.js` moves it between bands with
no second edit. Each card carries its number, grid size, difficulty, your best time and your
stars. Every tile is live — there are no padlocks and no disabled tiles — so a tile only ever
reads as cleared (green) or as the one you are up to (cyan, pulsing).

**Win screen** reveals the stars, then time, moves and coins earned with the payout
itemised line by line, the score and best combo, a "Level N reached" pill and a note when
you have beaten your own record — then offers **Play Next Level**, Play Again, Level Select
or Main Menu. Level 70 drops the next-level button and shows an "every level cleared" line
instead.

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

node tools/_engine-test.mjs "$PWD/.mirror"        # 240 headless engine assertions
node tools/_all-levels-test.mjs "$PWD/.mirror"    #   9 every level dealt, entered and cleared
node tools/_hint-test.mjs "$PWD/.mirror"          #  15 hint reveals-exactly-the-right-cards assertions
node tools/_reveal-payload-test.mjs               #  16 pair/mismatch/unflip payload is 2 cards, never the board
node tools/_powerup-coin-test.mjs                #  37 per-use coin-fee assertions
node tools/_wiring-check.mjs .                    # 228 static wiring/CSS checks
```

545 assertions in total, and every runner exits non-zero on a single failure.

The Windows mirror builder (`_build-win.mjs`) writes the `.mjs` copy into `./scratch-mmc`
and takes no arguments; the generic `_build-check.mjs` takes source and destination. Either
way, pass the mirror an **absolute** path to the test runners — they build `file://` URLs
from it, and a bare relative path resolves to a non-absolute URL on Windows.

The engine suite covers deck integrity on all 70 levels, the first-flip clock, the 1s
mismatch hold, combo scoring and combo-match counting, power-ups, the 3-star boundaries,
the coin formula (including part-second flooring and loss payouts), unlock progression,
coin-bank persistence across a reload, and that the Coming Soon teasers cannot be purchased
at any price. It also pins the round-shape rules that are easy to regress: hard mode's
75% clock with its 10-second floor reported through `snapshot().timeLimit` on every one of
the 70 levels, the hard-mode coin bonus as a line item whose itemised rows still sum to the
headline figure, a pair landing **on the final tick** scoring as a win rather than a loss
(the completion check is deferred behind the match animation, so the expiring tick has to
ask the board directly), power-ups refusing to fire while the board is locked or the round
is over, every level being enterable from a fresh save with 🪙0, the progress marker still
advancing on a clear without ever deciding what is playable, and a `volume` key missing from
an older save file reading as full volume rather than silence.

The **all-levels suite** is the one that takes "all 70 levels are in the game" literally: it
plays every level from the first flip to the win — twice, on two different symbol sets, 140
rounds in all — and checks each round dealt the right number of cards, dealt every symbol as
a true pair, ended `won` with the board reporting complete, took exactly one move per pair
and paid out coins. It also proves no theme is short of symbols for any level's pair count
(a 6×8 board needs 24 distinct symbols and there are 24 in every set) and that no level's
clock is under 5 seconds per pair. Rather than sleep through 1123 match animations it swaps
`_defer` for a synchronous call per instance — the engine's own completion check still runs
inside that callback, only the wait is skipped.

The **hint suite** pins the hint half of the old "revealing a pair reveals the
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
stock, or the engine refusing a locked board) burns neither.

The wiring check verifies every import, `EVENTS.*` key and referenced CSS class resolves,
that `core/` stays DOM-free, that the subscribe form sends nothing off-device, and that no
entrance animation uses a fill-mode that would defeat `:hover`. It also checks the two
things a unit test cannot reach. For **audio**: every `play('name')` call across the
codebase names a cue that exists in `SOUNDS` — a typo is silent rather than an error, so
static checking is the only thing that catches it — each of the three power-up keys is a cue
name, and the signal chain matches the diagram above, including that the limiter is the
*only* node reaching `ctx.destination` (anything else connecting directly would bypass it
and let the win stack clip). For the **70-level UI**: that `TOTAL_LEVELS` is derived from
the table, that level select's bands come from `difficulty` rather than hard-coded id
ranges, that the "you are here" scroll drives its own container instead of
`scrollIntoView()` (which walked every scrollable ancestor and dragged the sticky header
off-screen), and that the mobile query shrinks the difficulty tag to a colour chip rather
than hiding it — with five bands it is the only thing separating an expert board from a
master one. It also guards the "every level is open" rule from the other direction, by
asserting the removed pieces cannot come back: no padlock or coin pill in a tile, no
`aria-disabled` tile, no entry check gating the click in level select or on the win screen's
next-level button, no `locked`/`coins` refusal left in `canPlay`, and a zero coin gate on
every level definition.

Layout, glow and animation are verified by code inspection and these tests — there is no
headless browser here, so no rendered-pixel check.

## Credits

Built with vanilla HTML, CSS and JavaScript — no frameworks, no build step, no
dependencies. Emoji artwork comes from the system font; every sound is synthesised at
runtime with the WebAudio API, so there are no asset files at all.

Made with ❤️ for the world

## License

Released under the [MIT License](LICENSE) — free to use, modify and share.
