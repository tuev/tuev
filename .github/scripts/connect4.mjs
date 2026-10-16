// Connect 4 on a GitHub profile.
// Visitors play by opening an issue titled "connect4|drop|<1-7>" (or "connect4|new").
// This script applies the move, answers with a bot move and re-renders the board
// between the CONNECT4 markers of README.md. No dependencies, Node 20+.
import fs from 'node:fs';
import path from 'node:path';

const ROWS = 6;
const COLS = 7;
const HUMAN = 'R';
const BOT = 'Y';
const EMPTY = '.';
const SYMBOL = { R: '🔴', Y: '🟡', '.': '⚪' };
const COL_LABEL = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
const COL_ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first: better pruning and better play
const BOT_DEPTH = 5;
const HISTORY_SIZE = 5;

const STATE_FILE = 'game/state.json';
const README_FILE = 'README.md';
const START = '<!-- CONNECT4:START -->';
const END = '<!-- CONNECT4:END -->';

const repo = process.env.GITHUB_REPOSITORY || 'tuev/tuev';
const owner = process.env.REPO_OWNER || repo.split('/')[0];

// ---------------------------------------------------------------- game logic

const freshState = (score = { humans: 0, bot: 0, draws: 0 }) => ({
  board: Array.from({ length: ROWS }, () => EMPTY.repeat(COLS)),
  status: 'playing', // playing | won_human | won_bot | draw
  moves: 0,
  score,
  history: [],
});

const toGrid = (board) => board.map((row) => [...row]);
const fromGrid = (grid) => grid.map((row) => row.join(''));

function drop(grid, col, piece) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (grid[r][col] === EMPTY) {
      grid[r][col] = piece;
      return r;
    }
  }
  return -1;
}

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function windows(grid, visit) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of DIRECTIONS) {
        const er = r + 3 * dr;
        const ec = c + 3 * dc;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        visit([0, 1, 2, 3].map((i) => grid[r + i * dr][c + i * dc]));
      }
    }
  }
}

function isWinner(grid, piece) {
  let won = false;
  windows(grid, (w) => {
    if (w.every((cell) => cell === piece)) won = true;
  });
  return won;
}

const isFull = (grid) => grid[0].every((cell) => cell !== EMPTY);

function evaluate(grid) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    if (grid[r][3] === BOT) score += 3;
    else if (grid[r][3] === HUMAN) score -= 3;
  }
  windows(grid, (w) => {
    const bot = w.filter((x) => x === BOT).length;
    const human = w.filter((x) => x === HUMAN).length;
    const empty = 4 - bot - human;
    if (bot === 3 && empty === 1) score += 5;
    else if (bot === 2 && empty === 2) score += 2;
    if (human === 3 && empty === 1) score -= 4;
    else if (human === 2 && empty === 2) score -= 1;
  });
  return score;
}

function minimax(grid, depth, alpha, beta, maximizing) {
  if (isWinner(grid, BOT)) return 1_000_000 + depth;
  if (isWinner(grid, HUMAN)) return -1_000_000 - depth;
  if (isFull(grid)) return 0;
  if (depth === 0) return evaluate(grid);

  let best = maximizing ? -Infinity : Infinity;
  for (const c of COL_ORDER) {
    const r = drop(grid, c, maximizing ? BOT : HUMAN);
    if (r < 0) continue;
    const value = minimax(grid, depth - 1, alpha, beta, !maximizing);
    grid[r][c] = EMPTY;
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta) break;
  }
  return best;
}

function botMove(grid) {
  let bestScore = -Infinity;
  let candidates = [];
  for (const c of COL_ORDER) {
    const r = drop(grid, c, BOT);
    if (r < 0) continue;
    const value = minimax(grid, BOT_DEPTH - 1, -Infinity, Infinity, false);
    grid[r][c] = EMPTY;
    if (value > bestScore) {
      bestScore = value;
      candidates = [c];
    } else if (value === bestScore) {
      candidates.push(c);
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------------------------------------------------------------- turn handling

function playMove(state, col, user) {
  if (state.status !== 'playing') {
    return { ok: false, msg: 'This game is already over. Use the "Play again" link on the profile to start a new one.' };
  }
  const grid = toGrid(state.board);
  if (drop(grid, col, HUMAN) < 0) {
    return { ok: false, msg: `Column ${col + 1} is full, please pick another one.` };
  }

  state.moves += 1;
  const entry = { user, col: col + 1, botCol: null };
  let msg = `You dropped 🔴 in column ${col + 1}.`;

  if (isWinner(grid, HUMAN)) {
    state.status = 'won_human';
    state.score.humans += 1;
    msg += ' You win! 🎉';
  } else if (isFull(grid)) {
    state.status = 'draw';
    state.score.draws += 1;
    msg += ' The board is full: it is a draw. 🤝';
  } else {
    const botCol = botMove(grid);
    drop(grid, botCol, BOT);
    state.moves += 1;
    entry.botCol = botCol + 1;
    msg += ` 🤖 answered with 🟡 in column ${botCol + 1}.`;
    if (isWinner(grid, BOT)) {
      state.status = 'won_bot';
      state.score.bot += 1;
      msg += ' The bot wins this round. 🤖';
    } else if (isFull(grid)) {
      state.status = 'draw';
      state.score.draws += 1;
      msg += ' The board is full: it is a draw. 🤝';
    }
  }

  state.board = fromGrid(grid);
  state.history = [entry, ...state.history].slice(0, HISTORY_SIZE);
  return { ok: true, msg };
}

function newGame(state, user) {
  if (state.status === 'playing' && user.toLowerCase() !== owner.toLowerCase()) {
    return { ok: false, msg: 'A game is still in progress, finish it first. 🙂' };
  }
  const fresh = freshState(state.score);
  Object.assign(state, fresh);
  return { ok: true, msg: 'New game started! Your move: 🔴 goes first.' };
}

// ---------------------------------------------------------------- rendering

function render(state) {
  const issueUrl = (title) =>
    `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}` +
    `&body=${encodeURIComponent('Just press Submit new issue, the board updates itself in about 30 seconds.')}`;
  const playing = state.status === 'playing';

  const header = `| ${COL_LABEL.map((label, i) => (playing ? `[${label}](${issueUrl(`connect4|drop|${i + 1}`)})` : label)).join(' | ')} |`;
  const align = `|${Array(COLS).fill(':-:').join('|')}|`;
  const rows = state.board.map((row) => `| ${[...row].map((c) => SYMBOL[c]).join(' | ')} |`);

  const statusLine = {
    playing: '**Your move!** You are 🔴, the bot is 🟡. Click a column number to drop a disc.',
    won_human: '🎉 **A visitor beat the bot!**',
    won_bot: '🤖 **The bot won this round.**',
    draw: '🤝 **Draw!**',
  }[state.status];
  const again = playing ? '' : `\n\n[🔁 Play again](${issueUrl('connect4|new')})`;

  const { humans, bot, draws } = state.score;
  const scoreLine = `🏆 Visitors **${humans}** · 🤖 Bot **${bot}** · 🤝 Draws **${draws}**`;
  const recent = state.history.length
    ? `Recent moves: ${state.history
        .map((h) => `[${h.user}](https://github.com/${h.user}) → ${h.col}${h.botCol ? ` / 🤖 → ${h.botCol}` : ''}`)
        .join(' · ')}`
    : 'No moves yet, be the first!';

  return [
    START,
    '<div align="center">',
    '',
    statusLine,
    '',
    header,
    align,
    ...rows,
    '',
    scoreLine,
    '',
    `<sub>${recent}</sub>${again}`,
    '',
    '</div>',
    END,
  ].join('\n');
}

function updateReadme(state) {
  const readme = fs.readFileSync(README_FILE, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md must contain ${START} and ${END}`);
  }
  const next = readme.slice(0, start) + render(state) + readme.slice(end + END.length);
  if (next !== readme) fs.writeFileSync(README_FILE, next);
}

// ---------------------------------------------------------------- main

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const valid =
      Array.isArray(state.board) &&
      state.board.length === ROWS &&
      state.board.every((row) => typeof row === 'string' && row.length === COLS) &&
      ['playing', 'won_human', 'won_bot', 'draw'].includes(state.status) &&
      state.score &&
      Array.isArray(state.history);
    if (valid) return state;
  } catch {
    // fall through to a fresh game
  }
  return freshState();
}

// Issue authors are untrusted: only allow real GitHub login shapes into the README.
const safeUser = (login) =>
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(login ?? '') ? login : 'someone';

function main() {
  const title = (process.env.ISSUE_TITLE ?? '').trim();
  const user = safeUser(process.env.ISSUE_USER);
  const state = loadState();

  let outcome = null;
  const move = /^connect4\|drop\|([1-7])$/.exec(title);
  if (move) outcome = playMove(state, Number(move[1]) - 1, user);
  else if (title === 'connect4|new') outcome = newGame(state, user);
  else if (title) outcome = { ok: false, msg: 'I did not understand that move. Please use the links on the profile.' };

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  updateReadme(state);

  if (outcome && process.env.RESULT_FILE) {
    const body = `${outcome.ok ? '' : '⚠️ '}${outcome.msg}\n\nSee the board: https://github.com/${owner}`;
    fs.writeFileSync(process.env.RESULT_FILE, body);
  }
  console.log(outcome ? outcome.msg : 'Board rendered.');
}

main();
