# Chess Stockfish Analyzer для Render

Это готовый Flask-сайт с шахматной доской и анализом ходов через Stockfish.

## Важно

На Render нельзя использовать Windows-файл `stockfish-windows-x86-64-avx2.exe`, потому что Render работает на Linux. Поэтому в проект добавлен `Dockerfile`: во время деплоя Render сам установит Linux Stockfish через `apt-get install stockfish`.

## Как загрузить на GitHub

1. Распакуй ZIP.
2. Создай новый GitHub-репозиторий.
3. Загрузи все файлы из этой папки в корень репозитория.
4. Проверь, что в репозитории есть `Dockerfile`, `app.py`, `requirements.txt`, `templates`, `static`.

## Как запустить на Render

1. Открой Render.
2. New → Web Service.
3. Подключи GitHub-репозиторий.
4. Если Render спросит тип окружения, выбери Docker.
5. Если есть выбор команды, ничего не меняй: команда уже написана в Dockerfile.
6. Нажми Deploy.

Render сам выполнит:

```bash
apt-get install stockfish
pip install -r requirements.txt
gunicorn app:app --bind 0.0.0.0:$PORT
```

## Локальный запуск на Windows

Для Windows можно положить рядом с `app.py` файл:

```text
stockfish-windows-x86-64-avx2.exe
```

Потом запустить:

```bat
run_windows.bat
```

Локальный адрес:

```text
http://127.0.0.1:5000
```

## Переменная Stockfish

Если Stockfish лежит в другом месте, можно указать путь:

```bash
STOCKFISH_PATH=/usr/games/stockfish
```

## Почему Windows Stockfish не добавлен в ZIP

Файл `.exe` больше 100 МБ после распаковки и не подходит для Render. GitHub обычно не принимает файлы больше 100 МБ, а Render всё равно не сможет запустить Windows `.exe`. Для Render используется Linux Stockfish из Dockerfile.
