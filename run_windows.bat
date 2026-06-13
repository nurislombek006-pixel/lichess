@echo off
chcp 65001 >nul
echo Установка библиотек...
python -m pip install -r requirements.txt
echo.
echo Запуск сайта...
echo Если Stockfish не найден, положи stockfish-windows-x86-64-avx2.exe рядом с app.py
python app.py
pause
