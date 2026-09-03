// sudoku.js — generate a sudoku with a unique solution. Usage: node tools/sudoku.js [seed] [clues]
'use strict';
let seed = parseInt(process.argv[2] || '828', 10);
const targetClues = parseInt(process.argv[3] || '30', 10);
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function ok(g, r, c, v) {
  for (let i = 0; i < 9; i++) if (g[r * 9 + i] === v || g[i * 9 + c] === v) return false;
  const br = r - r % 3, bc = c - c % 3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (g[(br + i) * 9 + bc + j] === v) return false;
  return true;
}
function fill(g, pos = 0) {
  if (pos === 81) return true;
  if (g[pos]) return fill(g, pos + 1);
  const r = Math.floor(pos / 9), c = pos % 9;
  for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) { if (ok(g, r, c, v)) { g[pos] = v; if (fill(g, pos + 1)) return true; g[pos] = 0; } }
  return false;
}
function countSolutions(g, limit = 2) {
  let count = 0;
  function rec(pos) {
    if (count >= limit) return;
    while (pos < 81 && g[pos]) pos++;
    if (pos === 81) { count++; return; }
    const r = Math.floor(pos / 9), c = pos % 9;
    for (let v = 1; v <= 9; v++) if (ok(g, r, c, v)) { g[pos] = v; rec(pos + 1); g[pos] = 0; if (count >= limit) return; }
  }
  rec(0); return count;
}
const solution = new Array(81).fill(0); fill(solution);
const puzzle = solution.slice();
const order = shuffle([...Array(81).keys()]);
let clues = 81;
for (const p of order) {
  if (clues <= targetClues) break;
  const keep = puzzle[p]; puzzle[p] = 0;
  if (countSolutions(puzzle.slice()) !== 1) puzzle[p] = keep; else clues--;
}
const rows = g => Array.from({ length: 9 }, (_, r) => g.slice(r * 9, r * 9 + 9).map(v => v || '.').join(''));
console.log('clues:', clues);
console.log('PUZZLE'); console.log(rows(puzzle).join('\n'));
console.log('SOLUTION'); console.log(rows(solution).join('\n'));
console.log('JSON', JSON.stringify({ puzzle, solution }));
