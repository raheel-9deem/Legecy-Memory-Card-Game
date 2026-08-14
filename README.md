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
    level-select.js     Scrollable 20-level grid: locks, coin gates, best time, stars
    gameplay.js         Board rendering, driven entirely by engine events
    store.js            Tabbed shop: card backs, themes, power-ups, Coming Soon
    win.js              Result screen: star reveal, coin breakdown, next level
  ui/
    header.js           Coins / level / timer / moves + nav buttons
    timer-ring.js       Circular corner countdown, green → red as time drains
    particles.js        Canvas floating-particle background
    audio.js            Synthesised WebAudio sound effects (no asset files)
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

12 emoji sets, 18 symbols each: fruits, animals, space, food, sports, tech, transport,
nature, weather, music, shapes and flags. A level draws a **random theme each round** by
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

A loss pays nothing. Hard mode adds 25%. On a win the coins **fly from the board to the
header counter** along an arced path, and the counter tweens up as they land — the balance
itself is banked the instant it is earned, so leaving mid-flight can never lose a payout.
`core/coins.js` computes and banks; `ui/effects.js` owns the animation, keeping `core/`
free of DOM.

- **Power-ups** — Reveal (peek at every card), Freeze (stop the clock 10s), Shuffle.

## Store

Four tabs: **Card Backs** (5), **Themes** (12 plus the free random option), **Power-ups**
(restockable consumables) and **Coming Soon**.

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

`ui/audio.js` synthesises everything through WebAudio — no asset files. The context is
created lazily on the first user gesture, since browsers block it earlier.

| Cue | Trigger |
| --- | --- |
| `flip` | card turns over (tone + a noise transient for the snap) |
| `match` / `combo(n)` | pair matched; pitch climbs with the combo |
| `mismatch` | wrong pair |
| `coin` | payout and purchases |
| `click` | buttons and tabs |
| `error` | rejected action |
| `powerup` | power-up used |
| `levelComplete()` | level cleared (4-note rising melody) |
| `gameOver()` | time ran out (3-note falling melody) |

`audio.setMuted()` / `audio.toggleMute()` drive the **Sound effects** switch in Settings and
persist through the save file, so the preference survives a reload. Unmuting routes through
the engine on purpose: it has to unlock the audio context from inside the click gesture.

## Progress

Clearing a level unlocks the next one and writes the run to `localStorage` under
`memory-master:save:v2` — one save file holding the player record (`createdAt`,
`lastPlayed`, games played, best combo), the coin balance and lifetime earnings, per-level
best time / best stars / clear count, purchases and settings. Best records only ever
improve; a weaker replay leaves them alone.

**Level select** shows all 20 in a scrollable grid and scrolls to where you are. Each card
carries its number, grid size, difficulty, the coin balance the level gates on (red when
you are short), your best time and your stars. Locked levels are greyed, desaturated and
show a padlock.

**Win screen** reveals the stars, then time, moves and coins earned with the payout
itemised line by line, the score and best combo, a "Level N unlocked" pill and a note when
you have beaten your own record — then offers **Play Next Level**, Play Again, Level Select
or Main Menu. Level 20 drops the next-level button.

Keyboard: `Esc` / `P` pause, `M` main menu. The board auto-pauses if you switch tabs.

## Settings

Sound effects, background particles and hard mode (25% less time, 25% more coins) each
toggle from the menu's Settings modal. The particle field and all animations also
respect `prefers-reduced-motion`.

## Verifying

`tools/` holds dev-only Node scripts (no dependencies):

```bash
node tools/_build-check.mjs js .mirror   # mirror modules as .mjs so Node can import them
node tools/_engine-test.mjs "$PWD/.mirror"   # 197 headless engine assertions
node tools/_wiring-check.mjs .               # 172 static wiring/CSS checks
```

Pass the mirror an **absolute** path — `_engine-test.mjs` builds `file://` URLs from it.

The engine suite covers deck integrity on all 20 levels, the first-flip clock, the 1s
mismatch hold, combo scoring and combo-match counting, power-ups, the 3-star boundaries,
the coin formula (including part-second flooring and loss payouts), unlock progression,
coin-bank persistence across a reload, and that the Coming Soon teasers cannot be purchased
at any price. The wiring check verifies every import, `EVENTS.*` key and referenced CSS
class resolves, that `core/` stays DOM-free, that the subscribe form sends nothing
off-device, and that no entrance animation uses a fill-mode that would defeat `:hover`.
Layout, glow and animation are verified by code inspection and these tests — there is no
headless browser here, so no rendered-pixel check.

## Credits

Built with vanilla HTML, CSS and JavaScript — no frameworks, no build step, no
dependencies. Emoji artwork comes from the system font; every sound is synthesised at
runtime with the WebAudio API, so there are no asset files at all.

Made with ❤️ for the world

## License

Released under the [MIT License](LICENSE) — free to use, modify and share.
