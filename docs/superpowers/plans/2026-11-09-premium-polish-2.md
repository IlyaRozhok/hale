# Премиальная отделка, второй заход: план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** графитовый фон со светом сверху, сплошные карточки, полоса лимита с цветной искрой, цели списком, строки без контейнеров.
**Spec:** `docs/superpowers/specs/2026-11-09-premium-polish-2-design.md`. Ветка `feat/premium-polish-2`. Только `apps/mobile` и `packages/tokens`.

## Review Focus
1. Перерасход: заголовок красный, полоса полная красная; ровно ноль: заголовок белый, полоса красная.
2. Остаток ровно 25% — песочная искра; 26% — зелёная.
3. Без лимита полосы нет; без целей карточки целей нет; без платежей секции нет.
4. Недоступная нативная стеклянная подложка: меню и окна прежние, карточки сплошные в любом случае.
5. «Уменьшение движения»: искра не «дышит».

### Task 1: токены
`semantic.ts`: `color.limit = { ok: sage, low: "#D6B26E", over: "#E07A7A", overDeep: "#3A2224", strip: silver[100] }`, `color.backdrop.glow/mid`, `color.card = { fill: graphite[900], edge: graphite[800] }`, `type.amount` (52/600/−1.5). Тесты в `contrast.test.ts`: `limit.over` и `status.danger` читаются на `surface.base`; значения закреплены.

### Task 2: фон и карточки
`metal/Backdrop.tsx` → `components/Background.tsx` (Skia `RadialGradient`, неподвижный). `Glass kind="surface"` → `View` с `color.card.fill` и кромкой `color.card.edge` (тест в `Glass.test.tsx`). Удалить волны (`backdrop.sksl.ts`, `Backdrop.tsx`).

### Task 3: полоса
`metal/LimitBar.tsx` вместо `MetalBar`: `LimitBar({ level, state: "ok" | "low" | "over" })`; `limitState(leftToday, dailyLimit, level)` в `limitState.ts` (vitest): `over` при `leftToday <= 0`, `low` при `level <= 0.25`, иначе `ok`. При `over` полоса шириной 1 с градиентом `overDeep → over`. Искра 6 pt со свечением, «дыхание» 3.5 с, стоит при reduce-motion. Моки `../metal` в тестах: `LimitBar` с hint `bar:${state}:${level}`.

### Task 4: «Сегодня»
Заголовок «Сверх лимита» цветом `status.danger`; сумма стилем `type.amount`. «План до зарплаты» строкой без контейнера (значок `route`). `GoalsList` вместо `GoalCards`: карточка, итог «$X из $Y», строки с полосами, нажатие → `onOpenPlan`. `Upcoming` без `Glass`. Тесты в `Today.test.tsx`.

### Task 5: проверка и документы
Симулятор на локальном сервере: в лимите, мало, перерасход; цели; план. `status.md`, роадмап. Слияние и сборка — с согласия владельца.
