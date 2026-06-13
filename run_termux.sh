#!/data/data/com.termux/files/usr/bin/bash
pip install -r requirements.txt
export STOCKFISH_PATH=${STOCKFISH_PATH:-stockfish}
python app.py
