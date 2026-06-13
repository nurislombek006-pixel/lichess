import atexit
import os
import platform
import shutil
import stat
import threading
from pathlib import Path

import chess
import chess.engine
from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
app = Flask(__name__, static_folder="static", template_folder="templates")

_engine = None
_engine_lock = threading.Lock()
_engine_path = None


def find_stockfish() -> str | None:
    """Find Stockfish placed next to app.py, in ./bin, or installed in PATH."""
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and Path(env_path).exists():
        return str(Path(env_path).resolve())

    candidates = [
        BASE_DIR / "stockfish-windows-x86-64-avx2.exe",
        BASE_DIR / "stockfish-windows-x86-64.exe",
        BASE_DIR / "stockfish.exe",
        BASE_DIR / "stockfish",
        Path("/usr/games/stockfish"),
        Path("/usr/bin/stockfish"),
        BASE_DIR / "bin" / "stockfish-windows-x86-64-avx2.exe",
        BASE_DIR / "bin" / "stockfish.exe",
        BASE_DIR / "bin" / "stockfish",
    ]

    for path in candidates:
        if path.exists():
            if platform.system() != "Windows":
                try:
                    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                except OSError:
                    pass
            return str(path.resolve())

    path_from_os = shutil.which("stockfish")
    return path_from_os


def get_engine():
    global _engine, _engine_path
    with _engine_lock:
        if _engine is None:
            _engine_path = find_stockfish()
            if not _engine_path:
                raise RuntimeError(
                    "Stockfish не найден. Положи stockfish.exe рядом с app.py или укажи STOCKFISH_PATH."
                )
            _engine = chess.engine.SimpleEngine.popen_uci(_engine_path)
        return _engine


@atexit.register
def close_engine():
    global _engine
    if _engine is not None:
        try:
            _engine.quit()
        except Exception:
            pass


def score_to_cp(score: chess.engine.PovScore) -> int:
    obj = score.white()
    if obj.is_mate():
        mate = obj.mate()
        return 100000 if mate and mate > 0 else -100000
    return obj.score(mate_score=100000) or 0


def score_to_eval(score: chess.engine.PovScore) -> tuple[float, str]:
    obj = score.white()
    if obj.is_mate():
        mate = obj.mate()
        if mate is None:
            return 0.0, "M?"
        return (8.0 if mate > 0 else -8.0), f"M{abs(mate)}"
    cp = obj.score(mate_score=100000) or 0
    return cp / 100, f"{cp / 100:+.1f}"


def classify_move(before: chess.Board, user_move: chess.Move, depth: int):
    engine = get_engine()

    info_before = engine.analyse(before, chess.engine.Limit(depth=depth), multipv=1)
    best_move = info_before.get("pv", [None])[0]
    score_before = score_to_cp(info_before["score"])

    after = before.copy(stack=False)
    after.push(user_move)
    info_after = engine.analyse(after, chess.engine.Limit(depth=depth), multipv=1)
    score_after = score_to_cp(info_after["score"])
    eval_val, eval_text = score_to_eval(info_after["score"])

    # Потеря оценки с точки зрения стороны, которая сделала ход.
    if before.turn == chess.WHITE:
        loss_cp = max(0, score_before - score_after)
    else:
        loss_cp = max(0, score_after - score_before)

    # Простой дебютный маркер. Для полноценной дебютной базы можно позже подключить polyglot/openings DB.
    is_book_like = before.ply() < 8 and loss_cp <= 12

    if is_book_like:
        return "book", "📖 <b>Книжный ход.</b> Нормальное дебютное развитие.", eval_val, eval_text, best_move

    if best_move and user_move == best_move:
        # Без рандома: одинаковая партия всегда даст одинаковую оценку.
        # Жертву материала помечаем как блестящую только если оценка не просела.
        piece = before.piece_at(user_move.from_square)
        captured = before.piece_at(user_move.to_square)
        sacrifice = piece and captured and piece.piece_type > captured.piece_type and loss_cp <= 20
        if sacrifice:
            return "brilliant", "!! <b>Блестящий ход!</b> Сильная жертва без потери оценки.", eval_val, eval_text, best_move
        return "best", "★ <b>Лучший ход.</b> Первая линия Stockfish.", eval_val, eval_text, best_move

    if loss_cp <= 20:
        return "excellent", "👍 <b>Отличный ход.</b> Почти без потери оценки.", eval_val, eval_text, best_move
    if loss_cp <= 50:
        return "good", "✓ <b>Хороший ход.</b> Позиция остаётся нормальной.", eval_val, eval_text, best_move
    if loss_cp <= 100:
        return "inaccuracy", f"?! <b>Неточность.</b> Сильнее было: <code>{best_move}</code>.", eval_val, eval_text, best_move
    if loss_cp <= 220:
        return "mistake", f"? <b>Ошибка.</b> Лучше: <code>{best_move}</code>.", eval_val, eval_text, best_move
    return "blunder", f"?? <b>Зевок.</b> Сильнейший ход: <code>{best_move}</code>.", eval_val, eval_text, best_move


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    try:
        path = find_stockfish()
        return jsonify({"ok": bool(path), "stockfish_path": path or ""})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc), "stockfish_path": ""})


@app.post("/api/make_move")
def make_move():
    data = request.get_json(silent=True) or request.form
    move_uci = data.get("move", "")
    before_fen = data.get("before_fen", "")
    player_color = data.get("player_color", "white")
    depth = int(data.get("depth", 12))

    try:
        board = chess.Board(before_fen)
        user_move = chess.Move.from_uci(move_uci)
        if user_move not in board.legal_moves:
            return jsonify({"status": "error", "message": "Нелегальный ход."}), 400

        classification, comment, eval_val, eval_text, best_move = classify_move(board, user_move, depth)
        board.push(user_move)

        bot_from = ""
        bot_to = ""
        if not board.is_game_over() and (
            (player_color == "white" and board.turn == chess.BLACK)
            or (player_color == "black" and board.turn == chess.WHITE)
        ):
            engine = get_engine()
            result = engine.play(board, chess.engine.Limit(time=0.15))
            bot_move = result.move
            board.push(bot_move)
            bot_from, bot_to = bot_move.uci()[:2], bot_move.uci()[2:4]
            info = engine.analyse(board, chess.engine.Limit(depth=depth))
            eval_val, eval_text = score_to_eval(info["score"])

        return jsonify(
            {
                "status": "success",
                "classification": classification,
                "comment": comment,
                "eval_val": eval_val,
                "eval_text": eval_text,
                "best_move": best_move.uci() if best_move else "",
                "bot_from": bot_from,
                "bot_to": bot_to,
            }
        )
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@app.post("/api/bot_first_move")
def bot_first_move():
    data = request.get_json(silent=True) or request.form
    fen = data.get("fen", chess.STARTING_FEN)
    depth = int(data.get("depth", 10))
    try:
        board = chess.Board(fen)
        engine = get_engine()
        result = engine.play(board, chess.engine.Limit(time=0.15))
        move = result.move
        board.push(move)
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        eval_val, eval_text = score_to_eval(info["score"])
        return jsonify({"bot_from": move.uci()[:2], "bot_to": move.uci()[2:4], "eval_val": eval_val, "eval_text": eval_text})
    except Exception as exc:
        return jsonify({"bot_from": "", "message": str(exc)})


@app.post("/api/analyze_fen")
def analyze_fen():
    data = request.get_json(silent=True) or request.form
    fen = data.get("fen", chess.STARTING_FEN)
    depth = int(data.get("depth", 10))
    try:
        board = chess.Board(fen)
        engine = get_engine()
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        eval_val, eval_text = score_to_eval(info["score"])
        return jsonify({"eval_val": eval_val, "eval_text": eval_text})
    except Exception as exc:
        return jsonify({"eval_val": 0.0, "eval_text": "0.0", "message": str(exc)})


@app.post("/api/best_move")
def best_move():
    data = request.get_json(silent=True) or request.form
    fen = data.get("fen", chess.STARTING_FEN)
    depth = int(data.get("depth", 12))
    try:
        board = chess.Board(fen)
        engine = get_engine()
        info = engine.analyse(board, chess.engine.Limit(depth=depth))
        move = info.get("pv", [None])[0]
        return jsonify({"best_move": move.uci() if move else ""})
    except Exception as exc:
        return jsonify({"best_move": "", "message": str(exc)})


@app.post("/api/validate_fen")
def validate_fen():
    data = request.get_json(silent=True) or request.form
    fen = data.get("fen", "")
    try:
        chess.Board(fen)
        return jsonify({"valid": True})
    except Exception:
        return jsonify({"valid": False})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1"
    print(f"Сайт запускается: http://{host}:{port}")
    print("Stockfish:", find_stockfish() or "НЕ НАЙДЕН")
    app.run(host=host, port=port, debug=False)
