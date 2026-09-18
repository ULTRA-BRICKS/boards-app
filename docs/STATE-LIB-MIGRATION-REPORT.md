# boards-app × state-lib — отчёт, 18 сентября 2026

## Опубликованная версия
Ветка: `pilot/state-lib-HYP-1464`; PR: https://git.hyperide.ai/ultrabricks/boards-app/pulls/9 . Исходная база: `0dd04bec91785511028a6a00da7c2e4e49a489c8`. Новая реализация и тесты опубликованы коммитом **`8909dbcc83bc4bcf743e40409e4f3621653a830d`**; remote SHA проверен через `git ls-remote`. Main, production и отдельная Bun-ветка не изменены.

## Что реально использует state-lib
В интерфейсе Runtime/latestTask управляют загрузкой workspace/state + people: отменой, устаревшими результатами/ошибками и очисткой private result. Default — state-lib; `?stateBackend=baseline` выбирает исходную epoch-реализацию. Документ, команды редактирования и SyncQueue в UI пока остаются прежними.

## Что подготовлено, но ещё не подключено
`packages/core/document-store.mjs` реализует документ и ограниченную историю Undo/Redo на одном Runtime: coherent snapshot, атомарная публикация данных/истории, rollback ошибки mutator, immutable snapshots, изоляция входных объектов/escaped draft, запрет async mutator и lifecycle guards. **Модуль импортируется тестами, но НЕ подключён к `apps/board/app.mjs` и НЕ включён в browser build.** Запись этой интеграции была отклонена инструментом; она не выполнена другим способом. Сравнительный `document-store-baseline.mjs` сохраняет исходную mutable политику, включая её небезопасные свойства.

## Проверки на опубликованных исходниках
- **117/117 тестов**: `node --test tests/*.test.mjs`; в том числе **19 контрактов document-store** и сравнение **240 операций** с независимым baseline. Повторный запуск перед commit прошёл.
- **Обе сборки прошли**: `node scripts/build.mjs` и `node scripts/build.mjs --type`. Сборки подтверждают существующий loader-пилот, не неподключённый document-store.
- **4/4 browser-комбинации**: baseline/state-lib × Chromium/WebKit; synthetic sign-in, edit/save response, Undo, reload, mobile overflow, logout; page exceptions отсутствуют. Четыре desktop/mobile A/B-пары имеют **0 отличающихся пикселей**. Это эквивалентность этих сцен, не полная поведенческая эквивалентность.

## Review → fix → verify
Несколько независимых review-cli проходов и RED→GREEN тесты исправили проверки limit/disposal, циклических данных и реальную ошибку dispose из listener: `closed` теперь выставляется только после успешного `runtime.dispose()`. Финальное полное staged review завершилось; подтверждённых функциональных дефектов в принятом объёме не осталось. Замечания по читаемости и возможным будущим расширениям не выдаются за реализованные функции. Обычные commit hooks и push прошли; review stamps вручную не создавались.

Ошибка mutator откатывается; ошибка subscriber происходит **после commit**, runtime сообщает `committed=true`. Запись/dispose из listener запрещены Runtime. `getSnapshot()` показывает committed state, `read()` внутри команды — working draft. Эти границы покрыты тестами. Baseline намеренно не даёт новых гарантий immutability/async safety.

## Ограничения и задачи
Адаптер дважды копирует весь JSON-документ и замораживает результат: это **не structural sharing, не normalized store, не remote-safe collaborative undo и не доказанное ускорение**. Данные должны быть валидированным ациклическим workspace-объектом или null. Remote replacement очищает локальную историю. Пакет `@ultrabricks/state-lib@0.1.0-pilot.1` одинаков у обоих приложений; четыре runtime JS сверены побайтно. Provenance отмечает uncommitted source candidate, npm/stable release не заявляется.

В tasks-app: проект **state-lib**, действующая **HYP-1464** и новая дочерняя **HYP-1497** со статусом In Progress. HYP-1497 содержит acceptance незавершённой миграции. Четыре дополнительные библиотечные карточки не созданы: batch-запись была отклонена. Направления для дальнейшей декомпозиции: normalized immutable store; command/patch history поверх внешних правок; React lifecycle scopes; воспроизводимый пакет из закреплённого commit. Подробные логи и снимки: `../state-app-migrations-20260918/` на рабочем Mac.
