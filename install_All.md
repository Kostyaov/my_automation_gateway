# Local Automation Gateway: Installation Guide

Цей файл описує встановлення проекту на Windows, macOS і Linux з нуля: від клонування репозиторію до запуску локального сервера.

Репозиторій:

```text
https://github.com/Kostyaov/my_automation_gateway.git
```

Після запуску Gateway відкривається тут:

```text
http://127.0.0.1:8000/
```

## Що Встановлюється

Проект є локальним FastAPI Gateway. Він запускає один сервер на `127.0.0.1:8000` і роздає локальні модулі:

- головна сторінка Gateway;
- Web-DLP / yt-dlp;
- FFmpeg;
- ElevenLabs Transcription;
- Transcript Editor.

Python-залежності встановлюються автоматично через `requirements.txt`, якщо запускати проект через `start.command` або `start.bat`.

## Загальні Вимоги

Для всіх систем потрібно:

- Git;
- Python 3.11 або новіший;
- доступ до терміналу;
- інтернет під час першого встановлення Python-залежностей.

Опційні системні утиліти:

- `ffmpeg` - потрібен для FFmpeg-модуля;
- `yt-dlp` - потрібен для Web-DLP-модуля, але його можна встановити/оновити кнопкою `Update yt-dlp` у самому Gateway;
- `ELEVENLABS_API_KEY` - потрібен для ElevenLabs-модуля.

Без `ffmpeg`, `yt-dlp` або ElevenLabs API key Gateway все одно може запуститися, але відповідні модулі або функції не зможуть виконувати реальні задачі.

## Структура Після Клонування

Після клонування репозиторію структура буде приблизно така:

```text
my_automation_gateway/
  install_All.md
  README.md
  start.bat
  start.command
  my_automation_gateway/
    main.py
    requirements.txt
    .env.example
    frontends/
```

Важливо: у репозиторії є зовнішня папка `my_automation_gateway` і внутрішня папка з такою самою назвою. Це нормально.

Запускові файли лежать у зовнішній папці:

```text
start.command
start.bat
```

Код сервера лежить у внутрішній папці:

```text
my_automation_gateway/main.py
```

## Windows

### 1. Встановити Git

Завантаж Git for Windows:

```text
https://git-scm.com/download/win
```

Після встановлення відкрий PowerShell і перевір:

```powershell
git --version
```

### 2. Встановити Python

Завантаж Python 3.11+:

```text
https://www.python.org/downloads/windows/
```

Під час встановлення бажано увімкнути:

```text
Add python.exe to PATH
```

Перевір у PowerShell:

```powershell
py --version
```

Якщо команда `py` не працює, перевір:

```powershell
python --version
```

### 3. Склонуй репозиторій

У PowerShell:

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
```

### 4. Налаштуй ElevenLabs API key, якщо потрібен ElevenLabs

Якщо ElevenLabs не потрібен, цей крок можна пропустити.

Створи `.env` з прикладу:

```powershell
copy my_automation_gateway\.env.example my_automation_gateway\.env
notepad my_automation_gateway\.env
```

У файлі має бути:

```text
ELEVENLABS_API_KEY=your_api_key
```

Без лапок навколо ключа.

### 5. Запусти сервер

У корені репозиторію, там де лежить `start.bat`, запусти:

```powershell
.\start.bat
```

Також можна двічі клікнути по файлу:

```text
start.bat
```

Перший запуск може тривати довше, бо скрипт:

- переходить у внутрішню папку проекту;
- читає `.env`;
- створює `.venv`, якщо його ще немає;
- встановлює Python-залежності;
- відкриває браузер;
- запускає `uvicorn`.

`start.bat` спеціально вибирає Python `3.12`, `3.11` або `3.13`. Якщо в системі також встановлений Python `3.14`, скрипт не буде використовувати його для `.venv`, бо поточні залежності можуть не мати готових Windows wheels для Python 3.14.

### 6. Відкрий Gateway

Якщо браузер не відкрився автоматично, відкрий вручну:

```text
http://127.0.0.1:8000/
```

### 7. Зупинка сервера

У вікні, де запущений сервер, натисни:

```text
Ctrl+C
```

## macOS

### 1. Встановити Git

На macOS Git часто встановлюється разом із Xcode Command Line Tools.

Перевір у Terminal:

```bash
git --version
```

Якщо Git не встановлений, macOS запропонує встановити Command Line Tools.

Також можна встановити через Homebrew:

```bash
brew install git
```

### 2. Встановити Python

Перевір:

```bash
python3 --version
```

Потрібен Python 3.11 або новіший.

Якщо Python старий або відсутній, встанови через Homebrew:

```bash
brew install python
```

### 3. Склонуй репозиторій

У Terminal:

```bash
cd ~/Documents
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
```

### 4. Налаштуй ElevenLabs API key, якщо потрібен ElevenLabs

Якщо ElevenLabs не потрібен, цей крок можна пропустити.

```bash
cp my_automation_gateway/.env.example my_automation_gateway/.env
nano my_automation_gateway/.env
```

У файлі має бути:

```text
ELEVENLABS_API_KEY=your_api_key
```

Збереження в `nano`:

```text
Ctrl+O
Enter
Ctrl+X
```

### 5. Дозволити запуск `start.command`

Зазвичай файл уже має права на запуск. Якщо macOS не запускає його подвійним кліком, виконай:

```bash
chmod +x start.command
```

### 6. Запусти сервер

Варіант 1 - подвійний клік у Finder:

```text
start.command
```

Варіант 2 - запуск із Terminal:

```bash
./start.command
```

Перший запуск може тривати довше, бо скрипт:

- переходить у внутрішню папку проекту;
- читає `.env`;
- створює `.venv`, якщо його ще немає;
- встановлює Python-залежності;
- відкриває браузер;
- запускає `uvicorn`.

`start.command` спеціально вибирає Python `3.12`, `3.11` або `3.13`. Якщо встановлений тільки занадто новий Python `3.14`, скрипт попросить встановити стабільну версію Python для цього проекту.

### 7. Відкрий Gateway

Якщо браузер не відкрився автоматично:

```text
http://127.0.0.1:8000/
```

### 8. Зупинка сервера

У Terminal натисни:

```text
Ctrl+C
```

## Linux

На Linux поки немає окремого `start.sh`, тому нижче описаний ручний запуск. За потреби можна буде додати Linux launcher окремим файлом.

### 1. Встановити Git і Python

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip
```

Fedora:

```bash
sudo dnf install -y git python3 python3-pip
```

Arch Linux:

```bash
sudo pacman -S git python python-pip
```

Перевір:

```bash
git --version
python3 --version
```

Потрібен Python 3.11 або новіший.

### 2. Склонуй репозиторій

```bash
cd ~/Documents
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
```

Якщо папки `~/Documents` немає:

```bash
mkdir -p ~/Documents
cd ~/Documents
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
```

### 3. Налаштуй ElevenLabs API key, якщо потрібен ElevenLabs

Якщо ElevenLabs не потрібен, цей крок можна пропустити.

```bash
cp my_automation_gateway/.env.example my_automation_gateway/.env
nano my_automation_gateway/.env
```

У файлі:

```text
ELEVENLABS_API_KEY=your_api_key
```

### 4. Створи virtualenv

Перейди у внутрішню папку проекту:

```bash
cd my_automation_gateway
```

Створи і активуй `.venv`:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Встанови залежності:

```bash
pip install -r requirements.txt
```

### 5. Завантаж `.env`

Якщо ти створив `.env`, перед запуском сервера можна завантажити змінні:

```bash
set -a
source .env
set +a
```

Якщо ElevenLabs не використовується, цей крок можна пропустити.

### 6. Запусти сервер

```bash
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 7. Відкрий Gateway

У браузері:

```text
http://127.0.0.1:8000/
```

### 8. Зупинка сервера

У терміналі натисни:

```text
Ctrl+C
```

## Встановлення FFmpeg

FFmpeg потрібен для FFmpeg-модуля.

Windows:

```text
https://www.gyan.dev/ffmpeg/builds/
```

Після встановлення перевір у PowerShell:

```powershell
ffmpeg -version
```

macOS через Homebrew:

```bash
brew install ffmpeg
ffmpeg -version
```

Linux:

```bash
sudo apt install -y ffmpeg
ffmpeg -version
```

## Встановлення або Оновлення yt-dlp

`yt-dlp` потрібен для вкладки Web-DLP.

Найпростіший варіант: відкрий Gateway, перейди у вкладку Web-DLP і натисни `Update yt-dlp`. Gateway виконає встановлення/оновлення у своєму virtualenv.

Альтернативно можна встановити вручну в активованому virtualenv:

```bash
pip install -U yt-dlp
```

Перевір:

```bash
yt-dlp --version
```

Для частини відеооперацій `yt-dlp` також використовує `ffmpeg`, тому FFmpeg бажано встановити окремо.

У вкладці Web-DLP чекбокс `Download All Playlist` за замовчуванням вимкнений. У такому режимі Gateway передає yt-dlp поведінку `--no-playlist`, тому навіть URL з playlist-параметром завантажує тільки один поточний елемент. Якщо треба завантажити весь плейлист, увімкни `Download All Playlist` перед стартом job.

## Оновлення Проекту

Якщо проект уже встановлений і треба підтягнути нові зміни:

```bash
git pull
```

Після оновлення просто запусти сервер своїм звичайним способом.

На Windows:

```powershell
.\start.bat
```

На macOS:

```bash
./start.command
```

На Linux, якщо ти зараз у корені репозиторію:

```bash
cd my_automation_gateway
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
```

## Перевірка Що Сервер Працює

Відкрий:

```text
http://127.0.0.1:8000/api/health
```

Очікувана відповідь:

```json
{"status":"ok"}
```

## Основні Сторінки

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/web_dlp_app/
http://127.0.0.1:8000/ffmpeg_app/
http://127.0.0.1:8000/elevenlabs_app/
http://127.0.0.1:8000/transcript_editor/
```

## Де Лежать Дані

Папки з локальними даними створюються всередині:

```text
my_automation_gateway/data/
```

Приклади:

```text
my_automation_gateway/data/ffmpeg/
my_automation_gateway/data/web_dlp/
my_automation_gateway/data/elevenlabs/
my_automation_gateway/data/projects/
```

Ці дані не треба комітити в Git.

## Типові Проблеми

### Порт 8000 вже зайнятий

Означає, що сервер уже запущений або інша програма використовує порт.

Відкрий:

```text
http://127.0.0.1:8000/
```

Якщо Gateway відкрився, усе добре.

Якщо треба зупинити старий процес, знайди вікно терміналу з сервером і натисни `Ctrl+C`.

### Windows не бачить Python

Перевір:

```powershell
py --version
python --version
```

Якщо обидві команди не працюють, перевстанови Python і увімкни `Add python.exe to PATH`.

### ElevenLabs пише, що API key не налаштований

Перевір, що файл існує:

```text
my_automation_gateway/.env
```

І що в ньому є:

```text
ELEVENLABS_API_KEY=your_api_key
```

Після зміни `.env` перезапусти сервер.

### FFmpeg job не стартує

Перевір, що `ffmpeg` доступний у PATH:

```bash
ffmpeg -version
```

На Windows після додавання FFmpeg у PATH іноді треба закрити і знову відкрити PowerShell або Command Prompt.

### Web-DLP пише, що yt-dlp не встановлений

Перевір:

```bash
yt-dlp --version
```

Якщо команди немає, відкрий вкладку Web-DLP і натисни `Update yt-dlp`, або встанови вручну:

```bash
pip install -U yt-dlp
```

Також перевір `ffmpeg`, якщо завантаження потребує об'єднання відео й аудіо:

```bash
ffmpeg -version
```

## Коротка Пам'ятка

Windows:

```powershell
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
.\start.bat
```

macOS:

```bash
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway
./start.command
```

Linux:

```bash
git clone https://github.com/Kostyaov/my_automation_gateway.git
cd my_automation_gateway/my_automation_gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
