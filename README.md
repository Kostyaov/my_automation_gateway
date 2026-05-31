# Workspace Entry Point

Повний README проєкту лежить тут:

```text
my_automation_gateway/README.md
```

Якщо робота продовжується в новому чаті, спочатку прочитати саме цей файл. Фактичний корінь застосунку:

```text
my_automation_gateway/
```

Запуск сервера виконується з цієї папки:

```bash
cd my_automation_gateway
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Або подвійним кліком по macOS-файлу:

```text
start.command
```

ElevenLabs-модуль потребує змінної середовища:

```text
ELEVENLABS_API_KEY=your_api_key
```

Для `start.command` її можна покласти у:

```text
my_automation_gateway/.env
```
