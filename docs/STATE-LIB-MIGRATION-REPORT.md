# boards-app × state-lib — отчёт, 18 сентября 2026

## Граница версии
Ветка: `pilot/state-lib-HYP-1464`; проверенный base main: `0dd04bec91785511028a6a00da7c2e4e49a489c8`. Начальный HEAD этого прохода: `aba95e81c4a0d342bb7389d0e3b001db25537e0a`. Основная и незавершённая Bun-ветки приложения не изменялись.

В реально работающем UI state-lib управляет загрузкой workspace/state + people через Runtime/latestTask: отмена, устаревшие ответы, очистка private result. `?stateBackend=baseline` выбирает исходную epoch-реализацию, default — state-lib. Это уже существовавший пилот, а не заново созданное приложение.

## Добавлено в этом проходе
`packages/core/document-store.mjs`: Runtime-backed документ и bounded Undo/Redo; одна транзакционная публикация документа и истории, immutable snapshots, rollback при исключении, запрет async mutator, изоляция входных объектов и escaped draft. `document-store-baseline.mjs` сохраняет исходную mutable snapshot-политику для независимого сравнения.

**Новый document-store пока НЕ подключён к `apps/board/app.mjs` и НЕ входит в production bundle.** Команда интеграции была отклонена инструментом до выполнения; обхода отклонения не предпринималось. Фактические mutations/undo/SyncQueue в UI остаются прежними. Тест модуля нельзя выдавать за тест мигрированного UI.

## Исполненные проверки
`node --test tests/state-lib-document.test.mjs`: сначала RED на извлечённом baseline, затем **9/9 PASS** на новом адаптере. Проверены rollback данных/истории; неизменяемость старого snapshot; внешние/escaped ссылки; coherent cross-column move; Undo/Redo; очистка истории при замене; async rejection; closure-based commands; limit/disposal; **240 последовательных операций против baseline**.

Полная текущая suite `node --test tests/*.test.mjs`: **107 passed, 0 failed**. `node scripts/build.mjs` и `node scripts/build.mjs --type`: оба exit 0. Эти сборки содержат старый подключённый loader, не новый document-store.

## Цена и ограничения
Адаптер копирует весь JSON-документ до команды и ещё раз при commit, затем замораживает результат. Это не structural sharing, не normalized entity store и не доказательство ускорения. Undo локальный, snapshot-based; remote replacement очищает историю. Совместное редактирование, сохранение чужих правок при Undo и серверные гарантии не реализуются этим модулем.

Оба приложения используют private `@ultrabricks/state-lib@0.1.0-pilot.1`. `PROVENANCE.json` честно отмечает uncommitted source candidate; это не npm-релиз или stable API. Vendor dist не редактировался.

## Задачи и продолжение
В tasks-app создан проект `state-lib` (`57a446dc-14e2-4959-9a67-2000dc6d1d4b`) и **HYP-1497**, дочерняя к **HYP-1464**. В HYP-1497 перечислены реальные недостающие UI/domain-интеграции и acceptance gates. Попытка дополнительно создать четыре библиотечные задачи была отклонена до выполнения: они НЕ зарегистрированы. Рекомендации: normalized immutable store/structural sharing; command/patch history с remote-safe undo; reusable React lifecycle scopes; воспроизводимый пакет из закреплённого commit.

Полные локальные логи: соседняя директория `../state-app-migrations-20260918/`. Никакого merge в main, deployment, изменения пользовательской базы или production workspace в этом проходе не выполнялось.

## Browser readback этого прохода
`PILOT_EVIDENCE=../state-app-migrations-20260918/boards-browser node tests/state-lib-browser.mjs`: exit 0. Все **4 сочетания** baseline/state-lib × Chromium/WebKit прошли synthetic sign-in, изменение задачи с реальным save response, Undo, reload, mobile overflow и logout; page exceptions отсутствуют. Это проверка подключённого workspace-loader и старого редактора, НЕ нового document-store. Production не затронут.

HYP-1464 также привязан к новому проекту state-lib с сохранением остальных полей; новая HYP-1497 остаётся его дочерней задачей.

## Исправления после предварительного ревью
Ещё один RED→GREEN цикл воспроизвёл и исправил асимметричную проверку limit/backend, ошибки чтения после dispose и неинформативную рекурсию при циклическом документе. Все public readers/writers теперь одинаково отвергают доступ к закрытому адаптеру; invalid limit проверяется до dispatch. JSON snapshots явно ограничены ациклическими данными, не Map/Set/Date. Исходники и тесты отформатированы Oxfmt.

Добавлены контракты nested commands, write-from-listener, listener failure after commit, replace/clear, unsubscribe. Важно: исключение mutator откатывает данные/историю; ошибка subscriber происходит ПОСЛЕ commit и помечается runtime как `committed=true`. Runtime запрещает синхронные записи из listeners и доставляет остальные уведомления при ошибке одного listener; baseline сохраняет исходную recursive/fail-fast семантику. Эти исключительные сценарии теперь явно различены и протестированы, а не скрыты под обещанием полной A/B-эквивалентности.

Актуальный результат: **16 document-contract tests**, полная suite **114 passed / 0 failed**, обе сборки exit 0. Первоначальные 9/107 выше относятся к предыдущему этапу. UI-интеграция по-прежнему не выполнена. Четыре browser screenshot-пары baseline/state-lib дали 0 отличающихся пикселей; все 4 исполняемых runtime JS совпадают с tasks-app.

Предварительное review-cli завершено, замечания воспроизведены/исправлены или явно ограничены контрактом. Полный staged review запускается отдельно; ручные gate markers/stamps не создаются.

## Второй цикл ревью: lifecycle
Полное staged review обнаружило реальную ошибку dispose из listener: runtime отвергал освобождение во время notification, но adapter уже выставлял closed. Новый RED воспроизвёл это; теперь closed выставляется только после успешного runtime.dispose, и scope остаётся доступен для последующего корректного освобождения. Добавлены explicit-контракты committed getSnapshot против working read, а также legacy input aliasing/async/non-JSON hazards baseline. Последние намеренно сохраняют старое поведение, не обещаются эквивалентными защитам state-lib и должны быть учтены перед UI-подключением. Входная граница — прошедший schema validation объект workspace или null, не primitive root.

Актуальные подтверждённые показатели: **19 document tests; 117 общих тестов; обе сборки exit 0**. Новый финальный staged review запускается на исправленном индексе; предыдущий review не используется для сертификации новых байтов.
