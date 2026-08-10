# Memory Master

A polished single-page memory card game — glass morphism UI, neon accents, animated
particle background, 20 levels, coins, a store and power-ups. No build step, no
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
    levels.js           20 level definitions + the 3-star rating maths
    coins.js            Coin payout formula and the persistent coin bank
    router.js           SPA router; lazy-loads screens with dynamic import()
    storage.js          localStorage save file: player, progress, coins
    events.js           EventBus (EventTarget) + EVENTS name table
  data/
    themes.js           12 emoji symbol sets + random theme selection
    store-items.js      Card backs, store catalogue, power-up metadata
  screens/
    menu.js             Neon title, Play / Store / Settings, settings modal
    level-select.js     Level grid with locks, coin gates and star ratings
    gameplay.js         Board rendering, driven entirely by engine events
    store.js            Tabbed shop: card backs, themes, power-ups
    win.js              Result screen (Level Clear and Game Over)
  ui/
    header.js           Coins / level / timer / moves + nav buttons
    timer-ring.js       Circular corner countdown, green → red as time drains
    particles.js        Canvas floating-particle background
    audio.js            Synthesised WebAudio sound effects (no asset files)
    toast.js            Transient messages
    effects.js          Confetti and combo flashes
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

20 levels in six grid tiers. The time budget **tightens with every level inside a tier**,
then steps back up when the grid grows — a literal countdown across all 20 would make the
15-pair board unwinnable.

| Levels | Grid | Pairs | Time     | Difficulty |
| ------ | ---- | ----- | -------- | ---------- |
| 1–3    | 2×2  | 2     | 30→20s   | easy       |
| 4–6    | 2×3  | 3     | 42→30s   | easy       |
| 7–10   | 4×3  | 6     | 78→56s   | medium     |
| 11–15  | 4×4  | 8     | 104→74s  | medium/hard |
| 16–18  | 4×5  | 10    | 124→100s | hard       |
| 19–20  | 6×5  | 15    | 175→158s | expert     |

Each level also carries a `requiredCoins` **balance gate** — a minimum you must be
holding to enter, never spent — and a fallback theme used when no random one is drawn.
Grids re-orient to portrait on phones so cards stay large.

## Cards and matching

- **Front** is the face-down side: a woven-pattern gradient with a `?` and a small card-back
  badge. **Back** is the emoji. The 3D flip runs **0.6s** on `preserve-3d` with a slight
  settle overshoot.
- **Match** — both cards stay face up with a breathing green glow and a success chime.
- **Mismatch** — a red shake, then the pair flips back after **1 second**. The board is
  locked throughout, so nothing can be clicked mid-animation.
- **Combos** — consecutive matches multiply the score (100 × combo) and rise in pitch.

## Timer

The countdown **starts on the first card flip**, not when the board appears, so reading the
grid costs nothing. It renders as a circular SVG ring in the corner of the board, draining
clockwise from 12 o'clock and shifting green → amber → orange → red; the last stretch
pulses. At zero the round ends on the **Game Over** screen with Retry Level / Level Select
/ Main Menu.

## Themes

12 emoji sets, 18 symbols each: fruits, animals, space, food, sports, tech, transport,
nature, weather, music, shapes and flags. A level draws a **random theme each round** by
default (the free "Surprise Me" store option), weighted so easy levels stay gentle and
expert levels can pull the trickier lookalike sets. Equipping a specific theme in the
store pins it instead.

## Economy

- **Stars** rated on move efficiency and time remaining; coins scale with stars, time left
  and best combo.
- **Power-ups** — Reveal (peek at every card), Freeze (stop the clock 10s), Shuffle.
- **Store** — 5 card backs, 12 themes plus the free random option, restockable power-ups.
- **Progress** is saved to `localStorage` under `memory-master:save:v2`.

Keyboard: `Esc` / `P` pause, `M` main menu. The board auto-pauses if you switch tabs.

## Settings

Sound effects, background particles and hard mode (25% less time, 25% more coins) each
toggle from the menu's Settings modal. The particle field and all animations also
respect `prefers-reduced-motion`.

## Verifying

`tools/` holds dev-only Node scripts (no dependencies):

```bash
node tools/_build-check.mjs ./js /tmp/mmc   # mirror modules as .mjs
node tools/_engine-test.mjs /tmp/mmc        # 122 headless engine assertions
node tools/_wiring-check.mjs .              # 74 static wiring/CSS checks
```

The engine suite covers deck integrity on all 20 levels, the first-flip clock, the 1s
mismatch hold, combo scoring, power-ups, win/loss payouts and the timer colour ramp. The
wiring check verifies every import, `EVENTS.*` key and referenced CSS class resolves.
Layout, glow and animation are verified by code inspection and these tests — there is no
headless browser here, so no rendered-pixel check.
