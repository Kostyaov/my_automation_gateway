# Gateway Module Integration Guide

Цей документ описує, як розробляти новий модуль окремо від основного Gateway, тестувати його в ізольованому середовищі, а потім інтегрувати в `my_automation_gateway` максимально просто і без ризику зламати вже робочі модулі.

Поточний Gateway уже має робочі модулі:

- `whisper_app`
- `ffmpeg_app`
- `elevenlabs_app`
- `transcript_editor`

Основна ідея для нових модулів: розробляти їх як незалежний пакет із власним backend router, service-логікою, frontend-сторінкою, data-директорією і manifest-файлом. Після завершення та тестування модуль копіюється у Gateway і підключається за стабільним контрактом.

## 1. Рекомендований підхід

Для нового модуля, наприклад `yt-dlp`, краще не змінювати робочий Gateway під час активної розробки.

Рекомендована схема:

1. Створити окрему папку або окремий репозиторій для модуля.
2. Розробити там backend, frontend і тести.
3. Запускати його локально на окремому порту, наприклад `8010`.
4. Довести модуль до стабільного стану.
5. Перенести готові файли в Gateway.
6. Підключити router, frontend і карту на головній сторінці.

Так Gateway лишається робочим щодня, а новий модуль можна спокійно ламати, змінювати і вдосконалювати окремо.

## 2. Drop-in Module Contract v1

Кожен новий модуль має мати такі частини:

```text
<module_slug>_module/
├── README.md
├── module.manifest.json
├── requirements.optional.txt
├── backend/
│   ├── __init__.py
│   ├── models.py
│   ├── router.py
│   └── service.py
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── styles.css
└── tests/
    ├── test_service.py
    └── fixtures/
```

Для `yt-dlp` це може виглядати так:

```text
yt_dlp_module/
├── README.md
├── module.manifest.json
├── requirements.optional.txt
├── backend/
│   ├── __init__.py
│   ├── models.py
│   ├── router.py
│   └── service.py
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── styles.css
└── tests/
```

## 3. Manifest

Кожен модуль має містити `module.manifest.json`. Це не обов'язково має автоматично читатися Gateway вже зараз, але це дуже корисний контракт для майбутньої інтеграції.

Приклад для `yt-dlp`:

```json
{
  "schema_version": "gateway.module.v1",
  "slug": "yt_dlp",
  "display_name": "yt-dlp",
  "description": "Download video, audio, subtitles and metadata through yt-dlp.",
  "frontend": {
    "source_dir": "frontend",
    "gateway_mount_dir": "frontends/yt_dlp_app",
    "public_path": "/yt_dlp_app/"
  },
  "backend": {
    "router_import": "modules.yt_dlp.router:router",
    "api_prefix": "/api/yt-dlp",
    "data_dir": "data/yt_dlp"
  },
  "cli_dependencies": [
    "yt-dlp",
    "ffmpeg"
  ],
  "env": [
    {
      "name": "YTDLP_COOKIES_PATH",
      "required": false,
      "description": "Optional browser cookies file for authenticated downloads."
    }
  ],
  "endpoints": [
    "GET /api/yt-dlp/config",
    "GET /api/yt-dlp/files",
    "POST /api/yt-dlp/uploads",
    "POST /api/yt-dlp/jobs",
    "GET /api/yt-dlp/jobs/{job_id}",
    "WS /api/yt-dlp/jobs/{job_id}/events"
  ],
  "event_types": [
    "status",
    "log",
    "finished",
    "error"
  ],
  "integration_status": "standalone-ready"
}
```

## 4. Backend Contract

Новий backend бажано робити не як шматок коду для вставки в `main.py`, а як `APIRouter`.

Мінімальна структура:

```python
# backend/router.py
from fastapi import APIRouter

router = APIRouter(tags=["yt-dlp"])


@router.get("/config")
async def config():
    return {"status": "ok"}
```

Після перенесення в Gateway підключення має виглядати так:

```python
from modules.yt_dlp.router import router as yt_dlp_router

app.include_router(yt_dlp_router, prefix="/api/yt-dlp")
```

Це набагато простіше і безпечніше, ніж додавати великий блок endpoint-ів прямо в `main.py`.

## 5. Обов'язкові endpoint-и модуля

Для модулів, які запускають довгі CLI-команди, бажано підтримувати однакову форму API:

```http
GET  /api/<module>/config
GET  /api/<module>/files
POST /api/<module>/uploads
POST /api/<module>/jobs
GET  /api/<module>/jobs/{job_id}
WS   /api/<module>/jobs/{job_id}/events
```

Якщо модуль має експорт результатів:

```http
GET /api/<module>/jobs/{job_id}/export/{format_name}
```

Ця схема вже близька до того, що використовується в `ffmpeg_app` і `elevenlabs_app`.

## 6. Job Lifecycle

Кожна довга операція має працювати як job.

Стандартні статуси:

```text
queued
running
finished
failed
```

Стандартна відповідь `POST /jobs`:

```json
{
  "status": "accepted",
  "job": {
    "id": "abc123",
    "provider": "yt-dlp",
    "status": "queued",
    "created_at": "2026-05-31T00:00:00+00:00",
    "started_at": null,
    "finished_at": null,
    "error": null
  }
}
```

Стандартні WebSocket events:

```json
{
  "type": "log",
  "data": {
    "message": "Downloading video..."
  },
  "timestamp": "2026-05-31T00:00:00+00:00"
}
```

```json
{
  "type": "finished",
  "data": {
    "status": "finished",
    "message": "Download completed",
    "outputs": {
      "video": "/api/yt-dlp/jobs/abc123/export/video"
    }
  },
  "timestamp": "2026-05-31T00:00:00+00:00"
}
```

## 7. CLI Execution Rules

Усі важкі CLI-команди мають запускатися асинхронно.

Правильно:

```python
process = await asyncio.create_subprocess_shell(
    command,
    stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE,
)
```

Обов'язково:

- не блокувати FastAPI thread;
- логувати stdout/stderr у live console;
- використовувати `shlex.quote()` для шляхів, URL і параметрів;
- додати semaphore для важких задач;
- не запускати необмежену кількість паралельних job-ів;
- зберігати результат у `data/<module_slug>/outputs/`.

Для `yt-dlp` рекомендований старт:

```python
yt_dlp_semaphore = asyncio.Semaphore(1)
```

## 8. Data Layout

У Gateway кожен модуль має власну data-директорію:

```text
data/<module_slug>/
├── inputs/
├── outputs/
└── jobs/
```

Для `yt-dlp`:

```text
data/yt_dlp/
├── inputs/
├── outputs/
└── jobs/
```

Рекомендована схема іменування output-файлів:

```text
<source_or_title>_<job_id>.<ext>
```

Це запобігає перезапису старих результатів.

## 9. Frontend Contract

Frontend модуля має бути статичним:

```text
frontend/index.html
frontend/script.js
frontend/styles.css
```

Після інтеграції він копіюється в:

```text
frontends/<module_slug>_app/
```

Наприклад:

```text
frontends/yt_dlp_app/
├── index.html
├── script.js
└── styles.css
```

Усі API-запити з frontend мають бути відносними:

```js
fetch("/api/yt-dlp/jobs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

Не можна хардкодити окремий dev-port типу `http://127.0.0.1:8010` у фінальному frontend.

## 10. Shared Style Rules

Новий frontend має використовувати спільну тему Gateway:

```html
<link rel="stylesheet" href="/shared/theme.css" />
<script src="/shared/theme.js"></script>
```

Модульний `styles.css` має задавати тільки специфіку сторінки, а не дублювати всю тему.

Обов'язкові елементи для єдиного стилю:

- `module-shell`
- `module-topbar`
- `module-kicker`
- `module-title`
- `header-actions`
- `button-link`
- `theme-toggle`

Шапка модуля має містити:

```html
<a class="button-link" href="/">Gateway</a>
<button class="theme-toggle" type="button" data-theme-toggle>Темна тема</button>
```

## 11. Recommended yt-dlp Base Features

Для майбутнього `yt-dlp` модуля бажано почати з таких операцій:

1. Download best video + audio
2. Download audio only
3. Extract audio to mp3/m4a
4. Download subtitles
5. Download metadata/json
6. Download thumbnail
7. Use cookies file, якщо потрібно
8. Show live console output
9. Save output files in `data/yt_dlp/outputs/`

Початковий payload може бути таким:

```json
{
  "url": "https://example.com/video",
  "operation": "video",
  "output_template": "%(title)s.%(ext)s",
  "options": {
    "write_subs": true,
    "write_auto_subs": false,
    "audio_format": "m4a",
    "cookies_path": null
  }
}
```

## 12. Standalone Development Server

Поки модуль розробляється окремо, він може мати власний `main.py`:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.router import router

app = FastAPI(title="yt-dlp Module Dev")
app.include_router(router, prefix="/api/yt-dlp")
app.mount("/", StaticFiles(directory="frontend", html=True), name="static")
```

Запуск:

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8010
```

Після цього модуль можна тестувати окремо:

```text
http://127.0.0.1:8010/
```

## 13. Integration Checklist

Коли модуль готовий:

1. Скопіювати backend у Gateway:

```text
modules/<module_slug>/
```

2. Скопіювати frontend у Gateway:

```text
frontends/<module_slug>_app/
```

3. Додати залежності в `requirements.txt`, якщо потрібні Python-пакети.

4. Переконатися, що CLI-утиліти встановлені:

```bash
yt-dlp --version
ffmpeg -version
```

5. Підключити router у `main.py`:

```python
from modules.yt_dlp.router import router as yt_dlp_router

app.include_router(yt_dlp_router, prefix="/api/yt-dlp")
```

6. Додати картку на головну сторінку:

```html
<a href="/yt_dlp_app/">yt-dlp</a>
```

7. Перевірити:

```bash
python -m py_compile main.py modules/yt_dlp/*.py
node --check frontends/yt_dlp_app/script.js
```

8. Запустити Gateway:

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

9. Відкрити:

```text
http://127.0.0.1:8000/yt_dlp_app/
```

## 14. Acceptance Checklist

Модуль вважається готовим до інтеграції, якщо:

- standalone dev server запускається;
- frontend не має hardcoded dev-port;
- всі API URL відносні або починаються з `/api/<module>`;
- job запускається і повертає `accepted`;
- live console показує stdout/stderr;
- помилки CLI видно в UI;
- output-файли зберігаються і не перезаписують старі;
- повторний запуск створює новий `job_id`;
- `node --check frontend/script.js` проходить;
- `python -m py_compile` проходить;
- README модуля описує встановлення, запуск, параметри і відомі обмеження.

## 15. What To Avoid

Не варто:

- змінювати робочий Gateway під час ранньої розробки модуля;
- хардкодити абсолютні шляхи користувача;
- хардкодити dev-port у frontend;
- змішувати output різних модулів в одну папку;
- запускати CLI через синхронний `subprocess.run()` у web-request;
- робити довгу операцію без live console;
- робити модуль залежним від конкретної вкладки браузера;
- перезаписувати старі результати без підтвердження.

## 16. Recommended Handoff Prompt For A New Chat

Якщо розробка продовжується в новому чаті, достатньо дати такий контекст:

```text
Працюємо над окремим модулем <module_slug> для my_automation_gateway.
Дотримуйся MODULE_INTEGRATION_GUIDE.md.
Розробляємо standalone module на порту 8010.
Фінальна інтеграція має копіювати frontend у frontends/<module_slug>_app,
backend у modules/<module_slug>, підключати APIRouter через /api/<module_slug>,
і додавати картку на головну сторінку Gateway.
Gateway на 8000 має залишатися стабільним.
```

## 17. Current Recommendation For yt-dlp

Для `yt-dlp` я рекомендую робити окремий standalone module.

Причина: `yt-dlp` швидко обростає edge cases:

- cookies;
- playlists;
- subtitles;
- формат відео/аудіо;
- post-processing через ffmpeg;
- обмеження сайтів;
- довгі логи;
- помилки мережі;
- повторні спроби.

Це краще відшліфувати окремо, а в Gateway перенести вже стабільну версію.
