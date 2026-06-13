let board = null;
let game = new Chess();
let historyMoves = [];
let currentHistoryIdx = -1;
let playerColor = 'white';
let currentMode = 'play';

const stats = {
  brilliant: 0, great: 0, best: 0, excellent: 0, good: 0,
  book: 0, inaccuracy: 0, mistake: 0, missed: 0, blunder: 0
};

async function api(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Ошибка запроса');
  return data;
}

async function checkEngineStatus() {
  const el = document.getElementById('engine-status');
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (data.ok) {
      el.className = 'engine-pill ok';
      el.textContent = 'Stockfish найден: ' + data.stockfish_path;
    } else {
      el.className = 'engine-pill fail';
      el.textContent = 'Stockfish не найден. Положи exe рядом с app.py';
    }
  } catch (err) {
    el.className = 'engine-pill fail';
    el.textContent = 'Не удалось проверить Stockfish';
  }
}

function updateStatsUI() {
  for (const key of Object.keys(stats)) {
    const el = document.getElementById(`c-${key}`);
    if (el) el.textContent = stats[key];
  }
}

function onDragStart(source, piece) {
  if (currentMode === 'setup') return true;
  if (game.game_over() || currentHistoryIdx !== -1) return false;
  if (game.turn() !== playerColor[0]) return false;
  clearArrows();
}

async function onDrop(source, target) {
  if (currentMode === 'setup') return;
  clearArrows();
  const beforeFen = game.fen();
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';

  document.getElementById('mentor-box-log').innerHTML = '<span class="text-info"><i class="fa-solid fa-spinner fa-spin"></i> Stockfish анализирует...</span>';

  try {
    const data = await api('/api/make_move', {
      move: move.from + move.to + (move.promotion || ''),
      before_fen: beforeFen,
      player_color: playerColor,
      depth: Number(document.getElementById('engine-depth').value)
    });

    if (data.classification in stats) {
      stats[data.classification] += 1;
      updateStatsUI();
    }

    updateEvalBar(data.eval_val, data.eval_text);
    document.getElementById('mentor-box-log').innerHTML = data.comment;
    rebuildMoveLogUI();

    if (data.bot_from) {
      game.move({ from: data.bot_from, to: data.bot_to, promotion: 'q' });
      board.position(game.fen());
      updateEvalBar(data.eval_val, data.eval_text);
      rebuildMoveLogUI();
    }

    setTimeout(() => {
      document.querySelectorAll('.move-badge').forEach(el => el.remove());
      drawBadge(move.to, data.classification);
    }, 120);
  } catch (err) {
    document.getElementById('mentor-box-log').innerHTML = `<span class="text-danger"><b>Ошибка:</b> ${err.message}</span>`;
    game.undo();
    board.position(game.fen());
  }
}

function onSnapEnd() {
  if (currentMode !== 'setup') board.position(game.fen());
}

function drawBadge(square, classification) {
  const target = document.querySelector(`#board .square-${square}`);
  if (!target) return;
  const labels = {
    brilliant: '!!', great: '!', best: '★', excellent: '👍', good: '✓', book: '📖',
    inaccuracy: '?!', mistake: '?', missed: '✗', blunder: '??'
  };
  const badge = document.createElement('div');
  badge.className = `move-badge badge-${classification}`;
  badge.textContent = labels[classification] || '';
  target.appendChild(badge);
}

function drawArrow(from, to) {
  const fromEl = document.querySelector(`#board .square-${from}`);
  const toEl = document.querySelector(`#board .square-${to}`);
  if (!fromEl || !toEl) return;

  const boardEl = document.getElementById('board');
  const boardRect = boardEl.getBoundingClientRect();
  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();

  const scale = 560 / boardRect.width;
  let x1 = (fromRect.left - boardRect.left + fromRect.width / 2) * scale;
  let y1 = (fromRect.top - boardRect.top + fromRect.height / 2) * scale;
  let x2 = (toRect.left - boardRect.left + toRect.width / 2) * scale;
  let y2 = (toRect.top - boardRect.top + toRect.height / 2) * scale;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    x2 = x1 + (dx / len) * (len - 24);
    y2 = y1 + (dy / len) * (len - 24);
  }

  document.getElementById('best-move-line').setAttribute('x1', x1);
  document.getElementById('best-move-line').setAttribute('y1', y1);
  document.getElementById('best-move-line').setAttribute('x2', x2);
  document.getElementById('best-move-line').setAttribute('y2', y2);
  document.getElementById('arrow-svg').style.display = 'block';
}

function clearArrows() {
  document.getElementById('arrow-svg').style.display = 'none';
}

function updateEvalBar(val, text) {
  document.getElementById('eval-bar-text').textContent = text;
  let pct = 50 + (Number(val) / 8) * 50;
  pct = Math.max(4, Math.min(96, pct));
  if (playerColor === 'black') pct = 100 - pct;
  document.getElementById('eval-bar-fill').style.height = `${pct}%`;
}

function rebuildMoveLogUI() {
  historyMoves = game.history({ verbose: true });
  let html = '';
  for (let i = 0; i < historyMoves.length; i += 2) {
    const whiteMove = historyMoves[i];
    const blackMove = historyMoves[i + 1];
    const moveNum = Math.floor(i / 2) + 1;
    const wActive = i === currentHistoryIdx ? 'active-history-move' : '';
    const bActive = blackMove && i + 1 === currentHistoryIdx ? 'active-history-move' : '';
    html += `<div class="move-row">
      <div class="move-num">${moveNum}.</div>
      <div class="move-ply ${wActive}" onclick="goToHistoryIndex(${i})">${whiteMove.san}</div>
      <div class="move-ply ${bActive}" ${blackMove ? `onclick="goToHistoryIndex(${i + 1})"` : ''}>${blackMove ? blackMove.san : ''}</div>
    </div>`;
  }
  const box = document.getElementById('move-log-box');
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function getHistoryFen(idx = currentHistoryIdx) {
  const tempGame = new Chess();
  for (let i = 0; i <= idx; i++) tempGame.move(historyMoves[i].san);
  return tempGame.fen();
}

async function goToHistoryIndex(idx) {
  if (currentMode === 'setup') return;
  currentHistoryIdx = idx;
  clearArrows();
  document.querySelectorAll('.move-badge').forEach(el => el.remove());
  board.position(getHistoryFen(idx));
  rebuildMoveLogUI();
  try {
    const data = await api('/api/analyze_fen', { fen: getHistoryFen(idx), depth: Number(document.getElementById('engine-depth').value) });
    updateEvalBar(data.eval_val, data.eval_text);
  } catch (_) {}
}

function navMove(action) {
  if (!historyMoves.length || currentMode === 'setup') return;
  if (action === 'first') return goToHistoryIndex(0);
  if (action === 'prev') {
    let idx = currentHistoryIdx === -1 ? historyMoves.length - 2 : currentHistoryIdx - 1;
    return goToHistoryIndex(Math.max(0, idx));
  }
  if (action === 'next') {
    if (currentHistoryIdx === -1 || currentHistoryIdx >= historyMoves.length - 1) return;
    return goToHistoryIndex(currentHistoryIdx + 1);
  }
  if (action === 'last') {
    currentHistoryIdx = -1;
    clearArrows();
    document.querySelectorAll('.move-badge').forEach(el => el.remove());
    board.position(game.fen());
    rebuildMoveLogUI();
    api('/api/analyze_fen', { fen: game.fen(), depth: Number(document.getElementById('engine-depth').value) }).then(data => updateEvalBar(data.eval_val, data.eval_text)).catch(() => {});
  }
}

async function showBestMove() {
  clearArrows();
  const fen = currentHistoryIdx === -1 ? game.fen() : getHistoryFen();
  try {
    const data = await api('/api/best_move', { fen, depth: Number(document.getElementById('engine-depth').value) });
    if (data.best_move) drawArrow(data.best_move.substring(0, 2), data.best_move.substring(2, 4));
  } catch (err) {
    document.getElementById('mentor-box-log').innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

function changePlayerColor() {
  playerColor = document.getElementById('color-select').value;
  board.orientation(playerColor);
  clearArrows();
  document.querySelectorAll('.move-badge').forEach(el => el.remove());
  if (playerColor === 'black' && game.history().length === 0 && currentMode === 'play') triggerBotFirstMove();
}

async function triggerBotFirstMove() {
  try {
    const data = await api('/api/bot_first_move', { fen: game.fen(), depth: Number(document.getElementById('engine-depth').value) });
    if (data.bot_from) {
      game.move({ from: data.bot_from, to: data.bot_to, promotion: 'q' });
      board.position(game.fen());
      updateEvalBar(data.eval_val, data.eval_text);
      rebuildMoveLogUI();
    }
  } catch (err) {
    document.getElementById('mentor-box-log').innerHTML = `<span class="text-danger">${err.message}</span>`;
  }
}

function switchMode() {
  currentMode = document.getElementById('mode-select').value;
  clearArrows();
  document.querySelectorAll('.move-badge').forEach(el => el.remove());
  if (currentMode === 'setup') {
    document.getElementById('setup-controls').classList.remove('d-none');
    board = Chessboard('board', {
      draggable: true,
      dropOffBoard: 'trash',
      sparePieces: true,
      position: game.fen(),
      orientation: playerColor,
      pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });
  } else {
    document.getElementById('setup-controls').classList.add('d-none');
    applySetupPosition();
  }
}

async function applySetupPosition() {
  const rawFen = board.fen();
  const turn = document.getElementById('setup-turn').value;
  const fullFen = `${rawFen} ${turn} KQkq - 0 1`;
  try {
    const data = await api('/api/validate_fen', { fen: fullFen });
    if (!data.valid) return alert('Некорректная позиция. Проверь наличие обоих королей.');
    game.load(fullFen);
    currentMode = 'play';
    currentHistoryIdx = -1;
    document.getElementById('mode-select').value = 'play';
    document.getElementById('setup-controls').classList.add('d-none');
    initBoard(game.fen());
    rebuildMoveLogUI();
    document.getElementById('mentor-box-log').innerHTML = '<span class="text-success">Позиция установлена. Анализ готов.</span>';
  } catch (err) {
    alert(err.message);
  }
}

function exportData(type) {
  const text = type === 'fen' ? (currentHistoryIdx === -1 ? game.fen() : getHistoryFen()) : game.pgn();
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('mentor-box-log').innerHTML = type === 'fen' ? 'FEN скопирован.' : 'PGN скопирован.';
  });
}

function resetAllGame() {
  game.reset();
  initBoard('start');
  board.orientation(document.getElementById('color-select').value);
  playerColor = document.getElementById('color-select').value;
  currentHistoryIdx = -1;
  clearArrows();
  document.querySelectorAll('.move-badge').forEach(el => el.remove());
  Object.keys(stats).forEach(k => stats[k] = 0);
  updateStatsUI();
  rebuildMoveLogUI();
  updateEvalBar(0, '0.0');
  document.getElementById('mentor-box-log').innerHTML = 'Сессия очищена. Сделай первый ход.';
  if (playerColor === 'black') triggerBotFirstMove();
}

function initBoard(position) {
  board = Chessboard('board', {
    draggable: true,
    position,
    orientation: playerColor,
    onDragStart,
    onDrop,
    onSnapEnd,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initBoard('start');
  checkEngineStatus();
  updateStatsUI();
});

