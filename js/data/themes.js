/**
 * themes.js — Emoji symbol sets.
 *
 * Every set holds 24 unique symbols — exactly what the largest board (6×8,
 * 24 pairs) needs. This is a hard floor, not a comfort margin: GameBoard.build()
 * cycles the list when a theme is short, which would silently deal two visually
 * identical pairs onto the same board. `spread` marks sets whose symbols are
 * harder to tell apart at a glance — used to bias the random picker.
 */

export const THEMES = {
  fruits: {
    id: 'fruits', name: 'Fruit Basket', icon: '🍓', spread: 'easy',
    symbols: ['🍎','🍌','🍇','🍓','🍉','🍒','🍑','🍍','🥝','🥭','🍋','🍐','🫐','🥑','🍊','🍈','🥥','🍏','🍅','🫒','🍆','🌽','🥕','🌰'],
  },
  animals: {
    id: 'animals', name: 'Wild Kingdom', icon: '🦊', spread: 'easy',
    symbols: ['🐶','🐱','🦊','🐼','🦁','🐯','🐨','🐸','🦉','🦋','🐙','🦄','🐢','🦜','🐬','🦩','🐝','🐺','🐘','🐧','🐳','🦒','🐍','🦓'],
  },
  space: {
    id: 'space', name: 'Deep Space', icon: '🚀', spread: 'easy',
    symbols: ['🚀','🛸','🌍','🌙','⭐','☄️','🪐','🌌','👽','🔭','🛰️','☀️','🌠','🌑','🧑‍🚀','🌟','💫','🌕','🌜','🌓','🌎','🌏','🌞','🕳️'],
  },
  food: {
    id: 'food', name: 'Snack Bar', icon: '🍕', spread: 'easy',
    symbols: ['🍕','🍔','🌮','🌭','🍟','🍿','🥨','🧁','🍩','🍪','🎂','🍰','🍫','🍬','🍦','🥞','🧇','🍜','🍣','🍤','🥗','🍳','🥪','🍭'],
  },
  sports: {
    id: 'sports', name: 'Sports Day', icon: '⚽', spread: 'easy',
    symbols: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','⛳','🏒','🏹','🛹','🥇','🎳','🏆','🥈','🥉','🤿','⛸️','🏋️'],
  },
  tech: {
    id: 'tech', name: 'Cyber Deck', icon: '🤖', spread: 'medium',
    symbols: ['💻','🖥️','⌨️','🖱️','💾','📱','🎮','🕹️','🔌','🔋','📡','🤖','⚙️','📀','🖨️','📷','🎧','💡','💿','📼','🔦','🧲','📞','📠'],
  },
  transport: {
    id: 'transport', name: 'On the Move', icon: '🚗', spread: 'medium',
    symbols: ['🚗','🚕','🚌','🚑','🚒','🚓','🚜','🏍️','🚲','🛵','✈️','🚁','🚢','⛵','🚂','🛺','🛴','🚠','🚚','🚛','🚐','🚤','🚉','🛻'],
  },
  nature: {
    id: 'nature', name: 'Garden', icon: '🌻', spread: 'medium',
    symbols: ['🌵','🌲','🌳','🌴','🍀','🌿','🍁','🍄','🌸','🌻','🌹','🌷','🌺','💐','🌾','🪴','🌱','🍃','🌼','🪵','🌰','🍂','🐞','🕸️'],
  },
  weather: {
    id: 'weather', name: 'Forecast', icon: '🌈', spread: 'medium',
    symbols: ['☀️','🌤️','⛅','🌧️','⛈️','🌩️','❄️','☃️','🌪️','🌈','💧','🔥','🌊','🌫️','🌙','⚡','☔','🌡️','🌥️','🌦️','🌨️','🌬️','⛄','☁️'],
  },
  music: {
    id: 'music', name: 'Sound Stage', icon: '🎵', spread: 'medium',
    symbols: ['🎵','🎶','🎸','🎹','🎺','🎻','🥁','🎷','🪕','🎤','🎧','📻','🪘','🪗','🎼','🔔','📯','🎙️','🎚️','🎛️','📢','🔊','🔉','💽'],
  },
  shapes: {
    id: 'shapes', name: 'Neon Shapes', icon: '🔷', spread: 'hard',
    symbols: ['🔺','🔻','🔷','🔶','🟣','🟢','🔵','🟡','🟠','🔴','🟩','🟦','🟪','🟨','🟥','⬜','♦️','♠️','⬛','🟫','🟤','♥️','♣️','🔳'],
  },
  flags: {
    id: 'flags', name: 'World Flags', icon: '🏳️', spread: 'hard',
    symbols: ['🇯🇵','🇧🇷','🇨🇦','🇫🇷','🇩🇪','🇮🇹','🇪🇸','🇬🇧','🇺🇸','🇮🇳','🇰🇷','🇲🇽','🇦🇺','🇳🇬','🇸🇪','🇨🇭','🇵🇹','🇦🇷','🇳🇱','🇧🇪','🇬🇷','🇹🇷','🇪🇬','🇿🇦'],
  },
};

export const THEME_IDS = Object.keys(THEMES);

/** Sets that stay readable on the small, fast early boards. */
const GENTLE_THEMES = THEME_IDS.filter((id) => THEMES[id].spread === 'easy');
/** Sets that make a big board genuinely hard. */
const TRICKY_THEMES = THEME_IDS.filter((id) => THEMES[id].spread !== 'easy');

export function getTheme(id) {
  return THEMES[id] || THEMES.fruits;
}

/**
 * Pick a theme at random so no two plays of a level look the same.
 * Easy levels avoid the abstract sets; the hardest levels lean into them.
 * @param {'easy'|'medium'|'hard'|'expert'|'master'} difficulty
 */
export function randomThemeId(difficulty = 'medium') {
  const pool =
    difficulty === 'easy'   ? GENTLE_THEMES :
    difficulty === 'expert' ? TRICKY_THEMES :
    difficulty === 'master' ? TRICKY_THEMES :
    THEME_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}
