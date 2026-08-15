import fs from 'node:fs';
const s = fs.readFileSync('css/style.css', 'utf8');
const open = (s.match(/\/\*/g) || []).length;
const close = (s.match(/\*\//g) || []).length;
console.log('comment open:', open, 'close:', close);
const bare = s.replace(/\/\*[\s\S]*?\*\//g, '');
let d = 0, bad = 0;
for (const c of bare) { if (c === '{') d++; else if (c === '}') { d--; if (d < 0) bad++; } }
console.log('brace depth at EOF:', d, 'underflows:', bad);
console.log('backslashes in file:', (s.match(/\\/g) || []).length);
console.log('line 396 raw:', JSON.stringify(s.split('\n')[395]));
