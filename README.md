# Essential

Браузер на Chromium (Electron 45) в духе Zen и Arc: вертикальные вкладки, пространства со своими темами, закреплённые сайты, всплывающая адресная строка, панель «Сайт» с расширениями, онбординг при первом запуске.

## Запуск из исходников

```bash
npm install
npm start
```

## Сборка .exe

```bash
npm run dist
```

В `dist/` появятся установщик `Essential Setup <версия>.exe` и `Essential-<версия>-portable.exe`.

## Горячие клавиши

Все привычные сочетания Chrome (Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+L, Ctrl+F, F3, Ctrl+P, Ctrl+U, Ctrl+Shift+N и т. д.) плюс свои:

| Клавиши | Действие |
| --- | --- |
| Ctrl+S / Ctrl+Alt+C | скрыть/показать сайдбар |
| Ctrl+Alt+1…9 | пространство по номеру |
| Ctrl+D | закрепить сайт |
| Ctrl+Shift+C | скопировать ссылку |
| Ctrl+, | настройки |

Полный список — в «Настройки → Горячие клавиши».

## Расширения

API расширений Chrome (`chrome.tabs`, `windows`, `action`, `contextMenus`, `cookies`, `notifications` и др.) даёт [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell), установку из Chrome Web Store — [electron-chrome-web-store](https://www.npmjs.com/package/electron-chrome-web-store).

- Перенесённые из Arc, Chrome, Edge и других — `<профиль>/extensions/<id>` (кнопка «+» в панели «Сайт»).
- Установленные из Chrome Web Store — `<профиль>/WebStore`, обновляются сами.

## Настройки

Открываются кнопкой ⚙, по `Ctrl+,` или по адресу `essential://settings` (работают и `chrome://settings`, `arc://settings`). Раздел можно указать сразу: `essential://settings/privacy`, `essential://settings/devices` (микрофон и камера для сайтов).

## Лицензия

GPL-3.0 — см. [LICENSE](LICENSE). Проект использует electron-chrome-extensions, распространяемую под GPL-3.0.

## Файлы

- `main.js` — основной процесс: вкладки, пространства, сессия, настройки, импорт, хоткеи, «браузер по умолчанию»
- `importer.js` — перенос истории, закладок и запросов из Chrome, Edge, Яндекса, Opera/GX, Brave, Vivaldi, Arc, Zen, Firefox
- `extensions.js` — расширения Chrome: загрузка, перенос из других браузеров, иконки и названия
- `index.html`, `ui.js`, `style.css` — верхняя панель и сайдбар
- `spotlight.*` — всплывающая адресная строка с подсказками
- `siteinfo.*` — панель «Сайт» (расширения, PiP, разрешения сайта)
- `find.*` — поиск на странице (Ctrl+F)
- `media-preload.js` — выбранные микрофон и камера для сайтов
- `panel.*` — настройки и редактор тем
- `onboarding.*` — первый запуск
- `newtab.html` — страница новой вкладки
- `theme.js` — расчёт градиента темы
- `build/icon.png`, `assets/` — иконки
