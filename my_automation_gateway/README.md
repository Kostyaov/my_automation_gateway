# Local Automation Gateway

Це локальний FastAPI-шлюз для автоматизації рутинних задач через CLI-утиліти: `ffmpeg`, `yt-dlp` і хмарні API на кшталт ElevenLabs. Проєкт задуманий як один центральний сервер на `127.0.0.1:8000`, який:

- приймає запити з локальних HTML/JS-інтерфейсів;
- запускає важкі CLI-процеси у фоні;
- не блокує основний FastAPI-потік;
- роздає всі фронтенди зі своєї папки `frontends`;
- має спільну тему для всіх модулів;
- поступово стає єдиною локальною панеллю автоматизації.

## Поточний Етап

Стан на 2026-06-13: основний Gateway очищений від важких ML-залежностей і сфокусований на легких CLI/API-модулях.

Готово:

- Працює центральний FastAPI Gateway.
- Працює головна сторінка-каталог `/`.
- Працює спільна тема `light/dark` через `frontends/shared/theme.css` і `frontends/shared/theme.js`.
- Працює вкладка `Web-DLP` для запуску `yt-dlp` jobs.
- Інтегровано `Transcript Editor`, адаптований з `Kostyaov/transkript_edit`.
- `Transcript Editor` має локальне створення проєктів, завантаження аудіо, редагування сегментів і експорт.
- Додано окремий модуль `ElevenLabs Transcription` для хмарної транскрибації через ElevenLabs Speech to Text API.
- `Web-DLP` має:
  - download video;
  - extract audio;
  - download subtitles;
  - metadata/info JSON;
  - live console через WebSocket;
  - кнопку `Update yt-dlp`;
  - cancel job;
  - output folder picker/open.
- Вкладка `FFmpeg` вже має робочий job-based інтерфейс:
  - список операцій;
  - вибір відео/аудіо/input зі сканованих папок;
  - завантаження локальних файлів через браузер;
  - `Output path`;
  - запуск job;
  - live console через WebSocket;
  - збереження результатів у `data/ffmpeg/outputs`.

Що важливо для наступного чату:

- Не треба заново інтегрувати `Transcript Editor`: він уже підключений.
- Не треба заново будувати спільну тему: вона вже є.
- Не треба заново робити FFmpeg job system: базова система вже працює.
- ElevenLabs-модуль має upload, job API, exports, live console, credits block і інтеграцію з Transcript Editor.
- Whisper/MLX/WhisperX прототип винесений в окрему локальну git-гілку `whisper-experiment`, а не входить у чистий `main`.
- Поточний фокус розробки: доробляти легкі Gateway-модулі `Web-DLP`, `FFmpeg`, `ElevenLabs` без ML-залежностей у базовому runtime.

## Швидкий Запуск

Працювати треба з папки `my_automation_gateway`:

```bash
cd /Users/kostya/Documents/Codex/2026-05-30/api-cli-whisper-ffmpeg-yt-dlp/my_automation_gateway
```

Створити або активувати virtualenv:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Запустити сервер:

```bash
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --loop asyncio
```

На macOS також можна запускати сервер подвійним кліком по файлу в корені workspace:

```text
../start.command
```

На Windows аналогічний запуск доступний через batch-файл:

```text
../start.bat
```

Ці файли самі переходять у `my_automation_gateway`, підхоплюють `.env`, створюють `.venv` за потреби, встановлюють залежності, відкривають браузер і запускають `uvicorn`.

Відкрити в браузері:

```text
http://127.0.0.1:8000/
```

Основні сторінки:

- `http://127.0.0.1:8000/` - головний Gateway.
- `http://127.0.0.1:8000/web_dlp_app/` - Web-DLP / yt-dlp.
- `http://127.0.0.1:8000/ffmpeg_app/` - FFmpeg.
- `http://127.0.0.1:8000/elevenlabs_app/` - ElevenLabs Transcription.
- `http://127.0.0.1:8000/transcript_editor/` - Transcript Editor.

## Залежності

Python-залежності лежать у `requirements.txt`:

```text
fastapi==0.115.12
starlette==0.46.2
anyio==4.9.0
pydantic==2.11.7
httpx==0.28.1
python-dotenv==1.1.1
uvicorn[standard]==0.34.3
```

Системні CLI-залежності:

- `ffmpeg` - потрібен для FFmpeg-модуля.
- `yt-dlp` - потрібен для Web-DLP-модуля; його також можна встановити або оновити кнопкою `Update yt-dlp` у вкладці Web-DLP.
- `ELEVENLABS_API_KEY` - потрібен для ElevenLabs-модуля.

Перевірка:

```bash
ffmpeg -version
yt-dlp --version
```

ElevenLabs API key задається через environment variable:

```bash
export ELEVENLABS_API_KEY="your_api_key"
```

Для запуску через `start.command` або `start.bat` зручно створити файл:

```text
my_automation_gateway/.env
```

Приклад лежить тут:

```text
my_automation_gateway/.env.example
```

Формат:

```text
ELEVENLABS_API_KEY=your_api_key
```

## Структура Проєкту

```text
my_automation_gateway/
├── README.md
├── main.py
├── requirements.txt
├── transcript_subtitles.py
├── data/
│   ├── ffmpeg/
│   │   ├── inputs/
│   │   └── outputs/
│   └── projects/
└── frontends/
    ├── index.html
    ├── shared/
    │   ├── theme.css
    │   └── theme.js
    ├── web_dlp_app/
    │   ├── index.html
    │   └── script.js
    ├── ffmpeg_app/
    │   ├── index.html
    │   ├── styles.css
    │   └── script.js
    ├── elevenlabs_app/
    │   ├── index.html
    │   ├── styles.css
    │   └── script.js
    └── transcript_editor/
        ├── index.html
        ├── styles.css
        └── app.js
```

## Архітектура

`main.py` містить все backend-ядро:

- FastAPI app.
- Pydantic-моделі.
- CLI workers.
- Transcript Editor API.
- FFmpeg file/job API.
- Web-DLP job/update API.
- ElevenLabs file/job API.
- WebSocket для FFmpeg live console.
- WebSocket для Web-DLP live console.
- WebSocket для ElevenLabs live console.
- StaticFiles mount для фронтендів.

Статика монтується в самому кінці файлу:

```python
app.mount("/", StaticFiles(directory=FRONTENDS_DIR, html=True), name="static")
```

Це важливо: API routes мають бути оголошені до `app.mount("/")`, інакше StaticFiles може перехопити маршрути.

## Backend: Основні Папки Даних

У `main.py` визначені такі базові директорії:

```python
ROOT = Path(__file__).resolve().parent
FRONTENDS_DIR = ROOT / "frontends"
TRANSCRIPT_DATA_DIR = ROOT / "data" / "projects"
FFMPEG_DATA_DIR = ROOT / "data" / "ffmpeg"
FFMPEG_INPUT_DIR = FFMPEG_DATA_DIR / "inputs"
FFMPEG_OUTPUT_DIR = FFMPEG_DATA_DIR / "outputs"
WEB_DLP_DATA_DIR = ROOT / "data" / "web_dlp"
WEB_DLP_OUTPUT_DIR = WEB_DLP_DATA_DIR / "outputs"
ELEVENLABS_DATA_DIR = ROOT / "data" / "elevenlabs"
ELEVENLABS_INPUT_DIR = ELEVENLABS_DATA_DIR / "inputs"
ELEVENLABS_OUTPUT_DIR = ELEVENLABS_DATA_DIR / "outputs"
```

Призначення:

- `data/projects/` - локальне сховище Transcript Editor.
- `data/ffmpeg/inputs/` - файли, які користувач завантажує через FFmpeg UI.
- `data/ffmpeg/outputs/` - результати FFmpeg jobs.
- `data/web_dlp/outputs/` - результати Web-DLP / yt-dlp jobs.
- `data/elevenlabs/inputs/` - файли, які користувач завантажує через ElevenLabs UI.
- `data/elevenlabs/outputs/` - raw JSON і експортовані transcript-файли ElevenLabs jobs.

## Shared Theme

Спільна тема лежить тут:

- `frontends/shared/theme.css`
- `frontends/shared/theme.js`

Всі модулі мають використовувати ці файли. Якщо потрібно змінити кольори, шрифти, кнопки, основні панелі або light/dark тему, починати треба саме з `theme.css`.

Поточна домовленість по стилю:

- Світла тема залишається близькою до стилю `Transcript Sync Desk` / `Transcript Editor`.
- Темна тема має бути спокійна, не декоративна, комфортна для очей.
- Не використовувати стиль `AntiGravity Hub` як основний, бо він гарний, але відволікає від робочих задач.
- Нові вкладки мають брати базові класи зі shared theme, а не створювати повністю окрему дизайн-систему.

Ключові shared-класи:

- `.page-shell`
- `.page-header`
- `.page-title`
- `.page-subtitle`
- `.module-shell`
- `.module-topbar`
- `.module-kicker`
- `.module-title`
- `.button-link`
- `.theme-toggle`
- `.primary-button`
- `.hidden`

Тема зберігається в `localStorage` ключем:

```text
automation_gateway_theme
```

## Модуль: Gateway Home

Файл:

```text
frontends/index.html
```

Призначення:

- Головна сторінка-каталог.
- Має плитки з переходами на:
  - `/web_dlp_app/`
  - `/ffmpeg_app/`
  - `/transcript_editor/`
- Має перемикач теми.

## Модуль: Web-DLP

Файли:

```text
frontends/web_dlp_app/index.html
frontends/web_dlp_app/styles.css
frontends/web_dlp_app/script.js
```

Основні backend endpoints:

```http
GET /api/web-dlp/config
POST /api/web-dlp/jobs
POST /api/web-dlp/update
POST /api/web-dlp/jobs/{job_id}/cancel
WebSocket /api/web-dlp/jobs/{job_id}/events
```

Payload:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "operation": "download_video",
  "output_path": null,
  "options": {
    "quality": "best",
    "no_playlist": true,
    "cookies_browser": ""
  }
}
```

Підтримувані операції:

- `download_video`
- `extract_audio`
- `download_subtitles`
- `metadata`

Кнопка `Update yt-dlp` запускає:

```bash
python -m pip install -U yt-dlp
```

у тому Python virtualenv, де запущений Gateway.

Поточний стан:

- Приймає URL.
- Запускає `yt-dlp` у фоні як job.
- Показує live console через WebSocket.
- Має cancel job.
- Має output folder picker/open.
- Зберігає результати в `data/web_dlp/outputs` або обрану папку.

## Модуль: Transcript Editor

Файли frontend:

```text
frontends/transcript_editor/index.html
frontends/transcript_editor/styles.css
frontends/transcript_editor/app.js
```

Backend helper:

```text
transcript_subtitles.py
```

Джерело ідеї:

- Адаптовано з `Kostyaov/transkript_edit`.

Поточний стан:

- Модуль уже інтегрований у Gateway.
- Має кнопку `Gateway` у шапці.
- Використовує shared theme.
- Підтримує локальні проєкти.
- Підтримує аудіо.
- Підтримує редагування сегментів, speaker/text/time data.
- Підтримує експорт.

Підтримувані формати імпорту transcript:

- `.json`
- `.csv`
- `.vtt`
- `.srt`
- plain text fallback

Підтримувані формати експорту:

- `srt`
- `vtt`
- `txt`
- `csv`
- `json`

Основні API:

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
DELETE /api/projects/{project_id}
PUT    /api/projects/{project_id}/audio
GET    /api/projects/{project_id}/audio
GET    /api/projects/{project_id}/export/{format_name}
```

Структура одного проєкту:

```text
data/projects/<project_id>/
├── project.json
└── audio/
    └── <uploaded-audio-file>
```

Важлива деталь:

- У `data/projects/` уже може бути реальний робочий проєкт користувача.
- Не видаляти `data/projects/*` без прямого прохання.

## Модуль: ElevenLabs Transcription

Файли frontend:

```text
frontends/elevenlabs_app/index.html
frontends/elevenlabs_app/styles.css
frontends/elevenlabs_app/script.js
```

Backend helper:

```text
elevenlabs_transcription.py
```

Поточний стан:

- Модуль уже доданий у Gateway як окрема вкладка `/elevenlabs_app/`.
- Працює перевірка наявності `ELEVENLABS_API_KEY`.
- UI працює у простому upload-only режимі: файл вибирається кнопкою `Choose file from computer`.
- Працює upload локального файлу в `data/elevenlabs/inputs`.
- Працює створення job через `/api/elevenlabs/jobs`.
- Працює live console через WebSocket.
- Після успішної транскрипції backend зберігає:
  - raw JSON;
  - SRT;
  - VTT;
  - TXT.
- Якщо увімкнено `Create Transcript Editor project`, backend створює локальний проєкт у `data/projects/` і UI дає кнопку переходу в Transcript Editor.

Важливо:

- Реальний API-виклик до ElevenLabs перевірений.
- Локальна частина перевірена: сторінка, config endpoint, subscription endpoint, uploads endpoint, jobs endpoint, відкриття output folder, live console, export, створення Transcript Editor project.

Основні endpoint-и:

```http
GET  /api/elevenlabs/config
GET  /api/elevenlabs/subscription
GET  /api/elevenlabs/files
POST /api/elevenlabs/open-output-folder
POST /api/elevenlabs/uploads
POST /api/elevenlabs/jobs
GET  /api/elevenlabs/jobs/{job_id}
GET  /api/elevenlabs/jobs/{job_id}/export/{format_name}
WS   /api/elevenlabs/jobs/{job_id}/events
```

Job payload:

```json
{
  "file_path": "/path/to/audio-or-video.mp4",
  "model_id": "scribe_v2",
  "language_code": "uk",
  "tag_audio_events": false,
  "diarize": true,
  "no_verbatim": true,
  "num_speakers": null,
  "timestamps_granularity": "word",
  "enable_logging": true,
  "create_project": true
}
```

У UI `enable_logging` показано як зворотний перемикач `Zero retention mode`: якщо `Zero retention mode` вимкнений, `enable_logging` лишається `true`; якщо увімкнений, Gateway відправляє `enable_logging=false`.

Поточні дефолти налаштовані під чистий робочий текст: `tag_audio_events=false`, `diarize=true`, `no_verbatim=true`, `enable_logging=true`.

### Credits / баланс ElevenLabs

ElevenLabs UI показує блок `Credits` над формою запуску. Gateway отримує ці дані через:

```http
GET /api/elevenlabs/subscription
```

Backend звертається до офіційного ElevenLabs endpoint `GET /v1/user/subscription`, але в UI віддає тільки безпечну агреговану інформацію: тариф, статус, використано, ліміт, залишок і відсоток використання.

Залишок рахується так:

```text
remaining = character_limit - character_count
```

У термінології ElevenLabs ці поля історично називаються `character_count` і `character_limit`, але фактично відповідають поточним credits/usage акаунта.

Блок оновлюється при відкритті сторінки і після завершення ElevenLabs job.

Якщо ElevenLabs повертає помилку про відсутній `user_read`, це означає, що поточний API key може запускати transcription, але не має права читати subscription/billing usage. Для блоку credits треба увімкнути permission `user_read` для ключа або створити новий ключ з цим permission.

### Пояснення параметрів UI

#### Media File

Файл, який треба транскрибувати. Поточний UI використовує тільки явний upload з комп'ютера через кнопку `Choose file from computer`.

Якщо файл вибраний з комп'ютера, Gateway спочатку завантажує його в:

```text
data/elevenlabs/inputs/
```

Після цього саме цей локальний файл відправляється в ElevenLabs API.

#### Model

Доступні значення в UI:

- `scribe_v2`
- `scribe_v1`

Рекомендація: майже завжди залишати `scribe_v2`. Це основна актуальна модель для Speech to Text. `scribe_v1` залишений як fallback для порівняння або якщо з `scribe_v2` виникне проблема.

#### Language Code

Можна залишити порожнім. У такому випадку ElevenLabs спробує автоматично визначити мову.

Якщо мова відома, краще вказати код явно:

```text
uk
en
pl
ru
```

Для українських файлів рекомендовано ставити:

```text
uk
```

Це може покращити точність розпізнавання.

#### Speakers

Кількість мовців у записі. Цей параметр допомагає ElevenLabs точніше розділяти репліки, але сам по собі не вмикає розділення на мовців. Для цього має бути увімкнений параметр `Separate speakers`.

Можна залишити `Auto`, тоді ElevenLabs спробує визначити кількість мовців самостійно. Якщо точно відомо, що говорять, наприклад, дві людини, можна вказати:

```text
2
```

Це особливо корисно для інтерв'ю, діалогів, фокус-груп і нарад.

#### Timestamps

Доступні значення:

- `word`
- `character`

Рекомендація: залишати `word`.

`word` означає таймкоди на рівні слів. Це найкращий варіант для нашої архітектури, бо Gateway потім може зібрати з цих даних нормальні сегменти для Transcript Editor.

`character` означає таймкоди на рівні символів. Це потенційно детальніше, але для нашого редактора зазвичай зайве і може ускладнити обробку.

#### Tag audio events

Якщо увімкнено, ElevenLabs може додавати позначки аудіо-подій: сміх, музика, шум, паузи тощо, якщо модель це розпізнає.

За замовчуванням вимкнено, щоб у чистому робочому тексті не з'являлися вставки на кшталт `[сміється]`, `[музика]`, `[шум]`.

Рекомендація: вмикати тільки якщо для аналізу важливі саме аудіо-події.

#### Separate speakers

У backend цей параметр передається в ElevenLabs як `diarize=true`.

Якщо увімкнено, ElevenLabs додає до слів `speaker_id`, а Gateway збирає з них сегменти з різними мовцями для `.json`, `.srt`, `.vtt`, `.txt` і Transcript Editor.

Рекомендація: для інтерв'ю, фокус-груп, дзвінків і нарад залишати увімкненим. Якщо запис має тільки одного мовця або speaker labels не потрібні, можна вимкнути.

Важливо: старі транскрипції, зроблені без `diarize=true`, не можна автоматично розділити на мовців без повторної транскрипції, бо у raw JSON немає `speaker_id`.

#### Clean up filler words

У backend цей параметр передається в ElevenLabs як `no_verbatim=true`.

Якщо увімкнено, ElevenLabs намагається прибрати слова-заповнювачі, фальстарти і мовні збої: `е-е-е`, `м-м-м`, повтори на старті фрази, частину несловесних вставок.

За замовчуванням увімкнено, бо поточний стандарт модуля ElevenLabs - чистий робочий текст.

Рекомендація: вимикати для дослівної розшифровки фокус-груп, інтерв'ю і юридично/дослідницьки важливих матеріалів. Залишати увімкненим, якщо потрібен чистіший текст для читання, звіту, публікації або швидкого перегляду в Transcript Editor.

Важливо: якщо цей режим увімкнений, прибрані filler words уже не потраплять у raw JSON, `.srt`, `.vtt`, `.txt` і Transcript Editor. Для порівняння дослівної та очищеної версії треба запускати дві окремі транскрипції.

#### Zero retention mode

У UI цей параметр називається `Zero retention mode`.

За замовчуванням він вимкнений. У такому режимі Gateway не передає в ElevenLabs спеціальний параметр `enable_logging=false`, і транскрипція працює у стандартному режимі акаунта.

Якщо увімкнути `Zero retention mode`, Gateway відправить у ElevenLabs `enable_logging=false`. Для ElevenLabs це режим без логування/зберігання даних на стороні провайдера. Важливо: цей режим доступний не всім акаунтам. Якщо акаунт не має потрібного тарифу або trial-доступу, ElevenLabs поверне помилку 403.

Типова помилка:

```text
Only users from the enterprise or trial tier can use ZRM mode.
```

Рекомендація: залишати `Zero retention mode` вимкненим для звичайного акаунта ElevenLabs. Вмикати тільки якщо точно відомо, що акаунт підтримує ZRM/Zero Retention Mode.

#### Create Transcript Editor project

Якщо увімкнено, після успішної транскрипції Gateway автоматично створює локальний проєкт для Transcript Editor.

Рекомендація: залишати увімкненим, якщо планується ручне редагування, перевірка мовців, експорт субтитрів або подальша робота з текстом.

Якщо вимкнути, Gateway все одно збереже результати транскрипції у файли, але проєкт у Transcript Editor не створить.

### Що відбувається після транскрипції

Після натискання `Start transcription` виконується такий сценарій:

1. Gateway завантажує вибраний файл у `data/elevenlabs/inputs/`.
2. Backend створює job через `/api/elevenlabs/jobs`.
3. Файл відправляється в ElevenLabs Speech to Text API.
4. ElevenLabs повертає transcript у JSON.
5. Gateway перетворює відповідь ElevenLabs у внутрішній список `segments`.
6. Gateway зберігає результати в `data/elevenlabs/outputs/`.
7. Якщо увімкнено `Create Transcript Editor project`, Gateway створює проєкт у `data/projects/`.
8. У UI з'являються кнопки для завантаження результатів і, якщо створено проєкт, кнопка переходу в Transcript Editor.

Після успішної транскрипції створюється не один файл, а набір результатів:

```text
.json  - raw відповідь ElevenLabs + службові дані Gateway + segments
.srt   - SubRip subtitles
.vtt   - WebVTT subtitles
.txt   - простий текст
```

Файли зберігаються тут:

```text
data/elevenlabs/outputs/
```

У ElevenLabs UI є кнопка `Open transcripts folder` під `Start transcription`. Вона викликає backend endpoint `POST /api/elevenlabs/open-output-folder` і відкриває цю папку в Finder на macOS.

Якщо `Create Transcript Editor project` увімкнено, додатково створюється локальний проєкт:

```text
data/projects/<project_id>/
├── project.json
└── audio/
    └── <copy-of-source-audio-or-video>
```

Після цього в UI має з'явитися кнопка `Transcript Editor`. Вона відкриває:

```text
/transcript_editor/?project=<project_id>
```

Найзручніший сценарій роботи:

1. Вибрати файл.
2. Для української мови вказати `Language Code = uk`.
3. Залишити `Model = scribe_v2`.
4. Залишити `Timestamps = word`.
5. Залишити `Create Transcript Editor project` увімкненим.
6. Запустити транскрипцію.
7. Після завершення натиснути `Transcript Editor`.
8. Перевірити й відредагувати transcript локально.

Файли модуля:

```text
data/elevenlabs/inputs/
data/elevenlabs/outputs/
```

Scan dirs:

```python
Path.home() / "Downloads"
ELEVENLABS_INPUT_DIR
ELEVENLABS_OUTPUT_DIR
FFMPEG_OUTPUT_DIR
FFMPEG_INPUT_DIR
```

Що зробити наступним:

- Додати реальний `.env` з `ELEVENLABS_API_KEY`.
- Перезапустити Gateway.
- Запустити короткий audio test через `/elevenlabs_app/`.
- Перевірити raw JSON структуру ElevenLabs для реального файлу.
- За потреби скорегувати `build_segments_from_elevenlabs()` під фактичну відповідь.
- Перевірити якість автоматичного створення Transcript Editor project.

## Модуль: FFmpeg

Файли frontend:

```text
frontends/ffmpeg_app/index.html
frontends/ffmpeg_app/styles.css
frontends/ffmpeg_app/script.js
```

Поточний стан:

- Це активний модуль розробки.
- Інтерфейс уже працює.
- Файли можна вибирати зі списку або завантажувати з комп'ютера.
- `Start job` запускає backend job.
- Live console працює через WebSocket.
- `Output path` працює:
  - порожнє поле означає автоматичну назву в `data/ffmpeg/outputs`;
  - кнопка `Choose folder` відкриває системний вибір папки і записує результат у `Output path`;
  - просте ім'я файлу теж пишеться в `data/ffmpeg/outputs`;
  - якщо `Output path` є існуючою папкою, backend збереже файл у цю папку з автоматичною назвою;
  - абсолютний шлях до файлу пише у вказану директорію.
- Кнопка `Open output folder` відкриває папку останнього результату або стандартну `data/ffmpeg/outputs`.

### FFmpeg Scan Dirs

Backend сканує:

```python
Path.home() / "Downloads"
FFMPEG_OUTPUT_DIR
FFMPEG_INPUT_DIR
```

Тобто список файлів у UI береться з:

- `~/Downloads`
- `data/ffmpeg/outputs`
- `data/ffmpeg/inputs`

### FFmpeg Uploads

Endpoint:

```http
POST /api/ffmpeg/uploads
```

Headers:

```text
X-Filename: <filename>
Content-Type: <mime-type>
```

Body:

```text
raw file bytes
```

Файли зберігаються у:

```text
data/ffmpeg/inputs/
```

Якщо файл із такою назвою вже існує, backend створить унікальну назву типу:

```text
file-1.mp4
file-2.mp4
```

Підтримувані розширення:

```text
Video: .mp4, .mkv, .mov, .avi, .webm, .m4v
Audio: .mp3, .m4a, .wav, .aac, .flac, .ogg, .opus
Subtitle: .srt, .vtt, .ass
```

### FFmpeg Jobs

Основні endpoint-и:

```http
GET  /api/ffmpeg/operations
GET  /api/ffmpeg/files
POST /api/ffmpeg/select-output-folder
POST /api/ffmpeg/open-output-folder
POST /api/ffmpeg/uploads
POST /api/ffmpeg/jobs
GET  /api/ffmpeg/jobs/{job_id}
WS   /api/ffmpeg/jobs/{job_id}/events
```

Job payload:

```json
{
  "operation": "replace_audio",
  "inputs": {
    "video": "/path/to/video.mp4",
    "audio": "/path/to/audio.wav"
  },
  "output_path": "result.mp4",
  "options": {
    "shortest": true
  }
}
```

Job response:

```json
{
  "status": "accepted",
  "job": {
    "id": "abc123def456",
    "operation": "replace_audio",
    "status": "queued",
    "command_text": "ffmpeg ...",
    "output_path": "/absolute/path/to/output.mp4",
    "created_at": "...",
    "started_at": null,
    "finished_at": null,
    "return_code": null
  }
}
```

Live console events приходять через:

```text
ws://127.0.0.1:8000/api/ffmpeg/jobs/{job_id}/events
```

Події:

- `status`
- `log`
- `finished`
- `error`

### Поточні FFmpeg Операції

Backend registry:

```python
FFMPEG_OPERATIONS = {
    "replace_audio": build_replace_audio_command,
    "extract_audio": build_extract_audio_command,
    "cut_media": build_cut_media_command,
    "convert_mp4": build_convert_mp4_command,
    "compress_video": build_compress_video_command,
    "remove_audio": build_remove_audio_command,
    "remux_mp4": build_remux_mp4_command,
}
```

#### replace_audio

Призначення: замінити аудіо у відео.

Inputs:

- `video`
- `audio`

Options:

- `shortest: true/false`
- `audio_codec`, default `aac`

Команда по суті:

```bash
ffmpeg -y -i <video> -i <audio> -threads 2 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest <output>
```

#### extract_audio

Призначення: витягнути аудіо з media file.

Inputs:

- `input`

Options:

- `format`: `mp3`, `m4a`, `wav`, `aac`, `ogg`

#### cut_media

Призначення: обрізати media file по часу.

Inputs:

- `input`

Options:

- `start_time`, default `00:00:00`
- `stop_time`
- `copy`, default `true`

#### convert_mp4

Призначення: конвертація в H.264/AAC MP4.

Inputs:

- `input`

Options:

- `crf`, default `23`
- `preset`, default `medium`

#### compress_video

Призначення: стиснення відео через H.264 CRF.

Inputs:

- `input`

Options:

- `crf`, default `28`
- `preset`, default `slow`

#### remove_audio

Призначення: створити копію відео без аудіо.

Inputs:

- `input`

#### remux_mp4

Призначення: перепакувати compatible streams у MP4 без перекодування.

Inputs:

- `input`

### Як Додавати Нову FFmpeg Операцію

1. У `main.py` створити builder-функцію:

```python
def build_new_operation_command(payload: FFmpegJobRequest) -> tuple[list[str], Path]:
    source = resolve_media_path(payload.inputs.get("input", ""), "input")
    output = resolve_output_path(payload.output_path, output_name(source, "new_suffix", ".mp4"))
    command = ["ffmpeg", "-y", "-i", str(source), "-threads", "2", "...", str(output)]
    return command, output
```

2. Додати її в `FFMPEG_OPERATIONS`.

3. Додати option у `frontends/ffmpeg_app/index.html`.

4. Додати config у `frontends/ffmpeg_app/script.js`:

```js
new_operation: {
  input: "video",
  encode: true,
  description: "Human-readable description."
}
```

5. Якщо потрібні нові поля UI, додати їх в HTML, `getNodes()`, `updateOperationView()` і `buildPayload()`.

Головний принцип: не переписувати FFmpeg-модуль під кожну команду. Нові команди мають додаватися через registry + builder + маленький UI config.

## API Summary

Health:

```http
GET /api/health
```

Legacy FFmpeg endpoint:

```http
POST /api/ffmpeg
```

Web-DLP module API:

```http
GET  /api/web-dlp/config
POST /api/web-dlp/select-output-folder
POST /api/web-dlp/open-output-folder
POST /api/web-dlp/jobs
POST /api/web-dlp/update
GET  /api/web-dlp/jobs/{job_id}
POST /api/web-dlp/jobs/{job_id}/cancel
WS   /api/web-dlp/jobs/{job_id}/events
```

Новий FFmpeg module API:

```http
GET  /api/ffmpeg/operations
GET  /api/ffmpeg/files
POST /api/ffmpeg/select-output-folder
POST /api/ffmpeg/open-output-folder
POST /api/ffmpeg/uploads
POST /api/ffmpeg/jobs
GET  /api/ffmpeg/jobs/{job_id}
WS   /api/ffmpeg/jobs/{job_id}/events
```

ElevenLabs module API:

```http
GET  /api/elevenlabs/config
GET  /api/elevenlabs/subscription
GET  /api/elevenlabs/files
POST /api/elevenlabs/open-output-folder
POST /api/elevenlabs/uploads
POST /api/elevenlabs/jobs
GET  /api/elevenlabs/jobs/{job_id}
GET  /api/elevenlabs/jobs/{job_id}/export/{format_name}
WS   /api/elevenlabs/jobs/{job_id}/events
```

Transcript Editor:

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
DELETE /api/projects/{project_id}
PUT    /api/projects/{project_id}/audio
GET    /api/projects/{project_id}/audio
GET    /api/projects/{project_id}/export/{format_name}
```

## Асинхронність і Ресурси

Важливі домовленості:

- CLI-процеси не мають блокувати FastAPI.
- Для базових shell workers використовується `asyncio.create_subprocess_shell`.
- Для FFmpeg і Web-DLP job system використовується `asyncio.create_subprocess_exec`, бо команду зручніше і безпечніше збирати як список аргументів.
- Для важких процесів є семафори:

```python
ffmpeg_semaphore = asyncio.Semaphore(1)
web_dlp_semaphore = asyncio.Semaphore(1)
elevenlabs_semaphore = asyncio.Semaphore(1)
```

FFmpeg-команди обмежуються через:

```text
-threads 2
```

Це зроблено, щоб не забирати весь CPU на Mac mini M4 або іншій локальній машині.

## Важливі Поточні Файли Даних

У репозиторії зараз є тестові і робочі data-файли.

Не видаляти без прямого прохання:

```text
data/projects/
```

Там може бути реальний Transcript Editor проєкт користувача.

Тестові FFmpeg-файли, які можна вважати артефактами перевірок:

```text
data/ffmpeg/inputs/test_video.mp4
data/ffmpeg/inputs/test_audio.wav
data/ffmpeg/inputs/upload_smoke.wav
data/ffmpeg/outputs/test_video_audio_replaced.mp4
data/ffmpeg/outputs/http_smoke_replaced.mp4
data/ffmpeg/outputs/browser_smoke_replaced.mp4
data/ffmpeg/outputs/browser_smoke_after_upload_ui.mp4
```

Також у `data/ffmpeg/outputs/` може бути результат ручного тесту користувача, наприклад:

```text
data/ffmpeg/outputs/Ірина Липка_cut.mp3
```

Перед чисткою `data/ffmpeg/outputs/` краще уточнити у користувача.

## Перевірка Після Змін

Швидка перевірка Python:

```bash
.venv/bin/python -m py_compile main.py transcript_subtitles.py
```

Швидка перевірка FFmpeg JS:

```bash
node --check frontends/ffmpeg_app/script.js
```

Перевірка API:

```bash
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:8000/api/ffmpeg/operations
curl -s http://127.0.0.1:8000/api/ffmpeg/files
```

Браузерна перевірка:

1. Відкрити `/`.
2. Перевірити перемикач теми.
3. Перейти в `/ffmpeg_app/`.
4. Переконатися, що списки файлів заповнені.
5. Натиснути `Start job` без файлів і перевірити warning.
6. Вибрати video + audio.
7. Вказати `Output path`, наприклад `manual_test.mp4`.
8. Запустити job.
9. Перевірити live console.
10. Перевірити появу файлу в `data/ffmpeg/outputs/`.

## Поточні Обмеження

Загальні:

- Web-DLP, FFmpeg і ElevenLabs job history живе тільки в пам'яті.
- Немає persistence для FFmpeg jobs після перезапуску сервера.
- Немає авторизації, бо це локальний інструмент.
- Немає системного service/launchd файлу.
- Немає централізованого лог-файлу на диску.

Web-DLP:

- Немає історії completed jobs у UI після перезапуску.
- Немає batch queue для багатьох URL.
- Немає UI для cookie file, proxy або archive-файлу.
- Деякі сайти можуть потребувати browser cookies або свіжий `yt-dlp`.

ElevenLabs:

- Реальний API-виклик ще треба перевірити з ключем користувача.
- Job history живе тільки в пам'яті.
- Автоматичне створення Transcript Editor project копіює source file у `data/projects`, тобто великі відео можуть дублюватися на диску.
- Поки немає UI для перегляду історії попередніх ElevenLabs jobs після перезапуску.
- Поки немає окремого metadata/quality panel для raw ElevenLabs JSON.

FFmpeg:

- Є базові операції, але немає історії completed jobs у UI.
- Немає попереднього перегляду media.
- Немає batch processing.
- Немає шаблонів команд.
- Немає ffprobe metadata panel.

Transcript Editor:

- Вже робочий і інтегрований з ElevenLabs.
- Поки немає сценарію автоматичного імпорту результатів FFmpeg/Web-DLP.

## Найближчі Логічні Наступні Кроки

Рекомендований порядок:

1. Додати реальний `ELEVENLABS_API_KEY` у `.env`, перезапустити Gateway і перевірити короткий ElevenLabs transcription job.
2. За фактичним raw JSON ElevenLabs уточнити сегментацію в `elevenlabs_transcription.py`.
3. Протестувати Web-DLP на короткому URL, перевірити download video, extract audio і subtitles.
4. Додати Web-DLP batch queue для списку URL.
5. Додати в FFmpeg UI історію jobs і список outputs.
6. Додати кнопки `Download`, `Reveal path`, `Copy path` для результатів.
7. Додати `ffprobe` endpoint і metadata panel для вибраного файлу.
8. Додати нові FFmpeg операції:
   - merge video + audio;
   - normalize audio;
   - change resolution;
   - extract segment;
   - burn subtitles;
   - add subtitles as separate track;
   - convert audio format;
   - loudness normalization for speech.
9. Додати локальний service runner для macOS.

## Як Починати Новий Чат

Якщо доведеться продовжувати в новому чаті, достатньо дати агенту таку інструкцію:

```text
Прочитай my_automation_gateway/README.md. Це актуальний стан проєкту. Не аналізуй весь репозиторій з нуля без потреби. Продовжуємо з поточного етапу: Gateway працює, Transcript Editor інтегрований, shared light/dark theme є, FFmpeg module має job/upload/live-console основу, ElevenLabs module має upload/job/export/live-console/credits основу, Web-DLP module доданий для yt-dlp jobs. Whisper/MLX прототип винесений у локальну гілку whisper-experiment і не входить у чистий main.
```

Після цього варто перевірити тільки те, що потрібно для конкретної задачі:

- якщо задача про FFmpeg UI, дивитися `frontends/ffmpeg_app/*` і FFmpeg-блок у `main.py`;
- якщо задача про Web-DLP, дивитися `frontends/web_dlp_app/*` і `/api/web-dlp` у `main.py`;
- якщо задача про ElevenLabs, дивитися `frontends/elevenlabs_app/*`, `elevenlabs_transcription.py` і `/api/elevenlabs` у `main.py`;
- якщо задача про стиль, дивитися `frontends/shared/theme.css`;
- якщо задача про Transcript Editor, дивитися `frontends/transcript_editor/*`, `transcript_subtitles.py` і `/api/projects` у `main.py`;
- якщо задача про запуск, дивитися `requirements.txt` і команду `uvicorn`.

## Нотатки Для Розробника

- Не використовувати destructive git/file commands без прямого прохання.
- Не видаляти user data з `data/projects`.
- Не робити нову дизайн-систему для кожного модуля.
- Нові вкладки мають використовувати shared theme.
- Для важких CLI-команд завжди думати про CPU/thread limits.
- Для FFmpeg краще додавати команди через builder registry, а не хардкодити окрему логіку в багатьох місцях.
- `app.mount("/")` має лишатися в самому кінці `main.py`.
