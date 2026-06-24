# GitHub FAQ для цього проєкту

Коротка пам'ятка для ситуацій, які вже траплялися в роботі з `my_automation_gateway`, особливо коли проєкт тестується на Windows, а правильна версія вже запушена на GitHub.

## Головне правило

Якщо зміни вже перевірені і запушені в GitHub, то `origin/main` вважаємо правильною версією проєкту.

Ручне копіювання файлів на Windows допомагає швидко перевірити фікс, але після цього `git pull` може зупинитися з помилкою:

```text
Your local changes to the following files would be overwritten by merge
```

Це нормально: Git захищає локальні ручні зміни від перезапису.

## Хочу повністю оновити Windows з GitHub

Використовуй це, якщо локальні ручні зміни на Windows не потрібні, а GitHub містить правильну версію.

У PowerShell в папці проєкту:

```powershell
git fetch origin
git reset --hard origin/main
```

Це видалить локальні зміни у файлах, які відстежує Git, і поставить проєкт рівно в стан `origin/main`.

Після цього перевір:

```powershell
git status
```

Очікувано:

```text
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

## Що робить `git clean -fd`

`git reset --hard origin/main` не видаляє нові локальні файли, які Git не відстежує.

Якщо треба прибрати ще й такі файли:

```powershell
git clean -fd
```

Обережно: ця команда видаляє untracked файли і папки. Запускай її тільки якщо точно не треба зберігати локальні файли, які були створені вручну.

Перед видаленням можна подивитися, що саме буде прибрано:

```powershell
git clean -fdn
```

## Хочу зберегти локальні правки і підтягнути GitHub

Якщо на Windows є ручні зміни, які треба зберегти:

```powershell
git stash push -m "windows-local-changes"
git pull origin main
git stash pop
```

Якщо після `git stash pop` з'являться conflicts, їх треба буде розв'язати вручну. Для швидкої перевірки списку stash:

```powershell
git stash list
```

## Хочу перезаписати тільки конкретні файли з GitHub

Наприклад, якщо вручну копіювалися тільки FFmpeg-файли:

```powershell
git fetch origin
git restore --source=origin/main -- my_automation_gateway/main.py my_automation_gateway/frontends/ffmpeg_app/script.js
git pull origin main
```

Це перезапише тільки вказані файли версією з GitHub.

## Перед тим як пушити

Наш робочий процес:

1. Спочатку тестуємо локально.
2. Пушимо тільки після явної команди.
3. Перед commit/push перевіряємо стан:

```powershell
git status
```

Типовий цикл:

```powershell
git status
git add .
git commit -m "Short clear message"
git push origin main
```

## Корисна діагностика

Перевірити, на якій гілці ти зараз:

```powershell
git branch
```

Перевірити GitHub remote:

```powershell
git remote -v
```

Подивитися останні коміти:

```powershell
git log --oneline --decorate -5
```

Подивитися, які файли змінені локально:

```powershell
git status --short
```

## Якщо сумніваєшся

Якщо GitHub точно правильний, найчистіший шлях для Windows-машини:

```powershell
git fetch origin
git reset --hard origin/main
git status
```

Якщо є локальні файли, які шкода втратити, спочатку зроби копію папки або використай `git stash`.
