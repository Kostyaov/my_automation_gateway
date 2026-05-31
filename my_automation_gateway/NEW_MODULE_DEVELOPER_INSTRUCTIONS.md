# Інструкція для розробника нового модуля Gateway

Цей файл призначений для людини або нового AI-чату, який вперше бачить проект `my_automation_gateway` і має розробити новий модуль окремо від основної системи, а потім акуратно інтегрувати його в Gateway.

Основний технічний контракт описаний у:

```text
MODULE_INTEGRATION_GUIDE.md
```

Цей файл пояснює, як саме ним користуватися на практиці.

## 1. Що це за проект

`my_automation_gateway` - це локальний FastAPI Gateway для автоматизації CLI-інструментів і API-сервісів.

Поточна роль Gateway:

- тримати один локальний сервер на `http://127.0.0.1:8000`;
- хостити статичні frontend-сторінки;
- запускати довгі задачі у фоні;
- показувати live console для job-ів;
- зберігати результати в локальній папці `data/`;
- давати єдиний стиль і єдину точку входу для всіх модулів.

Поточні робочі модулі:

- Whisper transcription
- FFmpeg tools
- Transcript Editor
- ElevenLabs transcription

Головне правило: не ламати робочий Gateway під час експериментальної розробки нового модуля.

## 2. Які файли треба прочитати спочатку

Перед початком роботи прочитай ці файли в такому порядку:

```text
README.md
MODULE_INTEGRATION_GUIDE.md
NEW_MODULE_DEVELOPER_INSTRUCTIONS.md
```

`README.md` дає загальний стан проекту.

`MODULE_INTEGRATION_GUIDE.md` описує технічний контракт, структуру модуля, API, manifest, job lifecycle, frontend правила і checklist інтеграції.

`NEW_MODULE_DEVELOPER_INSTRUCTIONS.md` пояснює робочий процес для розробника.

## 3. Як користуватися MODULE_INTEGRATION_GUIDE.md

Не треба читати його як абстрактну документацію. Його треба використовувати як checklist.

Під час розробки модуля:

1. Візьми структуру з розділу `Drop-in Module Contract v1`.
2. Створи `module.manifest.json` за прикладом з розділу `Manifest`.
3. Backend роби через `APIRouter`, як описано в розділі `Backend Contract`.
4. Для довгих задач використовуй job lifecycle з розділу `Job Lifecycle`.
5. CLI-команди запускай тільки асинхронно за правилами `CLI Execution Rules`.
6. Frontend роби статичним і з відносними API URL.
7. Перед інтеграцією пройди `Acceptance Checklist`.
8. Після інтеграції пройди `Integration Checklist`.

Якщо розробляється `yt-dlp`, окремо дивись розділ:

```text
Recommended yt-dlp Base Features
```

## 4. Рекомендований workflow розробки нового модуля

Новий модуль бажано робити не всередині Gateway, а поруч або в окремому репозиторії.

Приклад:

```text
~/Documents/Codex/
├── api-cli-whisper-ffmpeg-yt-dlp/
│   └── my_automation_gateway/
└── yt_dlp_module/
```

У папці нового модуля має бути приблизно така структура:

```text
yt_dlp_module/
├── README.md
├── module.manifest.json
├── requirements.optional.txt
├── main.py
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

`main.py` у standalone-модулі потрібен тільки для розробки і тестів. У фінальному Gateway він не переноситься, якщо вся логіка вже є в `backend/router.py`.

## 5. Як запускати standalone-модуль

Standalone-модуль можна запускати на окремому порту, наприклад `8010`.

Приклад `main.py` для standalone-розробки:

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

Відкрити:

```text
http://127.0.0.1:8010/
```

Паралельно основний Gateway може працювати на:

```text
http://127.0.0.1:8000/
```

Так вони не заважають один одному.

## 6. Які правила має виконувати standalone-модуль

Модуль має поводитися так, ніби він уже частина Gateway.

Обов'язково:

- API routes мають починатися з `/api/<module>`;
- frontend має використовувати `fetch("/api/<module>/...")`;
- не можна хардкодити `http://127.0.0.1:8010` у frontend;
- всі CLI-команди мають бути асинхронними;
- довгі операції мають працювати як background job;
- live console має показувати stdout/stderr;
- output-файли не мають перезаписувати старі результати;
- кожен запуск має створювати новий `job_id`;
- помилки мають бути видимі в UI;
- module README має пояснювати запуск, параметри і обмеження.

## 7. Мінімальний API, який очікується від модуля

Для CLI-модулів бажано підтримувати такий API:

```http
GET  /api/<module>/config
GET  /api/<module>/files
POST /api/<module>/uploads
POST /api/<module>/jobs
GET  /api/<module>/jobs/{job_id}
WS   /api/<module>/jobs/{job_id}/events
```

Якщо модуль створює файли для завантаження:

```http
GET /api/<module>/jobs/{job_id}/export/{format_name}
```

Для `yt-dlp` це може бути:

```http
GET  /api/yt-dlp/config
GET  /api/yt-dlp/files
POST /api/yt-dlp/jobs
GET  /api/yt-dlp/jobs/{job_id}
WS   /api/yt-dlp/jobs/{job_id}/events
GET  /api/yt-dlp/jobs/{job_id}/export/video
GET  /api/yt-dlp/jobs/{job_id}/export/audio
GET  /api/yt-dlp/jobs/{job_id}/export/metadata
```

## 8. Як зрозуміти, що модуль готовий до інтеграції

Перед перенесенням у Gateway модуль має пройти такі перевірки:

```bash
python -m py_compile main.py backend/*.py
node --check frontend/script.js
```

Також треба вручну перевірити:

- сторінка відкривається на standalone-порту;
- кнопка запуску реально створює job;
- live console показує прогрес;
- помилки CLI видно в UI;
- результати зберігаються в `data/<module>/outputs/`;
- повторний запуск не перезаписує старий результат;
- після reload сторінки можна отримати status job-а;
- README модуля зрозумілий без додаткових пояснень.

Якщо щось із цього не працює, модуль ще не готовий до інтеграції.

## 9. Що робити після виготовлення нового модуля

Коли модуль готовий і протестований окремо, треба інтегрувати його в Gateway.

### Крок 1. Зупинити Gateway або переконатися, що немає активних job-ів

Не інтегруй модуль під час активної транскрипції, ffmpeg-job або іншої довгої операції.

### Крок 2. Скопіювати backend

У Gateway створити:

```text
modules/<module_slug>/
```

Наприклад:

```text
modules/yt_dlp/
```

Скопіювати туди:

```text
backend/__init__.py
backend/models.py
backend/router.py
backend/service.py
```

У Gateway це може бути спрощено до:

```text
modules/yt_dlp/
├── __init__.py
├── models.py
├── router.py
└── service.py
```

### Крок 3. Скопіювати frontend

У Gateway створити:

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

### Крок 4. Скопіювати manifest

Скопіювати:

```text
module.manifest.json
```

у:

```text
modules/<module_slug>/module.manifest.json
```

### Крок 5. Додати залежності

Якщо модуль має Python-залежності, перенести їх з:

```text
requirements.optional.txt
```

у Gateway `requirements.txt`, якщо вони потрібні в основному середовищі.

Якщо модуль залежить від CLI-утиліт, перевірити їх окремо:

```bash
yt-dlp --version
ffmpeg -version
```

### Крок 6. Підключити backend router

У `main.py` Gateway додати імпорт:

```python
from modules.yt_dlp.router import router as yt_dlp_router
```

Після створення `app = FastAPI(...)` і до `app.mount("/", ...)` додати:

```python
app.include_router(yt_dlp_router, prefix="/api/yt-dlp")
```

Важливо: `app.mount("/", StaticFiles(...))` має залишатися в самому кінці `main.py`, інакше static mount може перехопити API routes.

### Крок 7. Додати картку на головну сторінку

У:

```text
frontends/index.html
```

додати посилання:

```html
<a href="/yt_dlp_app/">yt-dlp</a>
```

Картка має відповідати стилю існуючих модулів.

### Крок 8. Перевірити синтаксис

У папці Gateway:

```bash
python -m py_compile main.py modules/yt_dlp/*.py
node --check frontends/yt_dlp_app/script.js
```

### Крок 9. Запустити Gateway

```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

або через локальний `start.command`, якщо він використовується для цього проекту.

### Крок 10. Відкрити сторінку модуля

```text
http://127.0.0.1:8000/yt_dlp_app/
```

Після цього перевірити весь happy path:

1. сторінка відкривається;
2. API config працює;
3. job створюється;
4. live console показує лог;
5. output-файл створюється;
6. export/download працює;
7. повторний запуск не затирає попередній результат.

## 10. Що не переносити в Gateway

З standalone-модуля не треба переносити:

- standalone `main.py`, якщо він потрібен тільки для dev-сервера;
- `.venv`;
- `__pycache__`;
- тимчасові output-файли;
- тестові великі медіафайли;
- локальні `.env` із секретами;
- hardcoded absolute paths;
- експериментальні файли, не потрібні для роботи модуля.

## 11. Що обов'язково перенести

Обов'язково перенести:

- backend router;
- backend service logic;
- Pydantic models;
- frontend `index.html`;
- frontend `script.js`;
- frontend `styles.css`;
- `module.manifest.json`;
- короткий module README або секцію в основному `README.md`;
- якщо потрібно, fixtures або маленькі тестові файли без приватних даних.

## 12. Як оформити передачу готового модуля

Коли модуль готовий, розробник має передати короткий звіт:

```text
Module: yt-dlp
Status: standalone-ready
Standalone URL: http://127.0.0.1:8010/
API prefix: /api/yt-dlp
Frontend target: frontends/yt_dlp_app/
Backend target: modules/yt_dlp/
Required CLI: yt-dlp, ffmpeg
Required env: YTDLP_COOKIES_PATH optional
Tested operations:
- video download
- audio extract
- subtitles download
- metadata export
Known limitations:
- playlists not supported yet
- cookies only via file path
```

Цей звіт треба додати в README модуля або в повідомлення при передачі.

## 13. Prompt для нового AI-чату

Якщо робота починається в новому чаті, можна дати такий prompt:

```text
Ми розробляємо standalone-модуль <module_slug> для проекту my_automation_gateway.
Основний Gateway має залишатися стабільним і працює окремо на http://127.0.0.1:8000.
Новий модуль розробляємо окремо на порту 8010.

Прочитай:
1. README.md
2. MODULE_INTEGRATION_GUIDE.md
3. NEW_MODULE_DEVELOPER_INSTRUCTIONS.md

Дотримуйся Drop-in Module Contract v1:
- backend через APIRouter;
- frontend статичний;
- API routes через /api/<module_slug>;
- live console через WebSocket;
- довгі CLI-команди через asyncio.create_subprocess_shell;
- output у data/<module_slug>/outputs;
- без hardcoded dev-port у frontend.

Після готовності підготуй модуль до копіювання в Gateway:
- backend у modules/<module_slug>;
- frontend у frontends/<module_slug>_app;
- manifest у modules/<module_slug>/module.manifest.json;
- короткий integration report.
```

## 14. Рекомендація для yt-dlp

Для `yt-dlp` модуль краще розробляти окремо, бо він має багато змінних:

- різні сайти;
- playlists;
- cookies;
- відео/аудіо формати;
- subtitles;
- metadata;
- thumbnails;
- ffmpeg post-processing;
- network errors;
- rate limits;
- довгі CLI-логи.

Першу версію варто зробити маленькою:

1. URL input.
2. Operation select: video, audio, subtitles, metadata.
3. Start job.
4. Live console.
5. Output files.
6. Download/open output.

Після цього вже можна розширювати.

## 15. Коротко

Правильна стратегія така:

```text
Develop standalone -> test hard -> freeze contract -> copy into Gateway -> connect router -> add frontend card -> verify on port 8000
```

Gateway має залишатися стабільним. Новий модуль має приходити вже як готовий drop-in пакет.
