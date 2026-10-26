# RNNoise: происхождение и воспроизводимость

Выбран `@shiguredo/rnnoise-wasm@2025.1.5`: закреплённый wrapper Shiguredo, исходники,
рецепт сборки, лицензия Apache-2.0, RNNoise Xiph BSD-3-Clause. Он не требует LiveKit
Cloud/Krisp, работает с AudioWorklet и подходит для self-hosted Hub. Это сторонний
wrapper с собственными условиями поддержки, не официальный пакет LiveKit.

Полные реквизиты, точный upstream commit, SHA-256 поставляемого JS/WASM,
лицензии и команда upstream сборки: [NOTICE](../third_party/rnnoise/NOTICE.md).
Официальные источники: [Xiph RNNoise](https://github.com/xiph/rnnoise),
[Shiguredo wrapper](https://github.com/shiguredo/rnnoise-wasm/tree/2025.1.5).
GPL-компоненты в выбранную RNNoise цепочку не включены. Это не юридическая экспертиза
всех зависимостей Electron; перед внешним распространением проверяйте notices сборки.

## Сборка

`npm ci` получает закреплённый artifact с npm integrity из package-lock.
`node scripts/prepare-rnnoise.mjs` дополнительно проверяет SHA-256, затем меняет только
проверку окружения single-file wrapper, разрешая Worklet/Node. Сам WASM/модель не меняются.
Генерируемый rnnoise.generated.js не хранится в Git; web/desktop build вызывает скрипт.
Обновление версии требует отдельного пересмотра guard, checksum, лицензии и DSP-тестов.
Для полной пересборки WASM из C используйте upstream рецепт из NOTICE; Emscripten
в систему сервера Hub автоматически не устанавливается.

Vite выпускает отдельный enhanced-worklet asset (~4.8 MB до сжатия), загружаемый только
при первом выборе RNNoise и запуске микрофона. В desktop он входит в installer,
в web отдаётся собственным Caddy. Runtime CDN, платных API и внешних моделей нет.
Браузер кэширует asset по hash; каждый новый AudioContext создаёт свой denoise state.
CSP требует только `script-src 'self' 'wasm-unsafe-eval'` и `worker-src 'self'`,
без общего unsafe-eval, wildcard или отключения webSecurity.

## Проверки и ограничения

Unit-тест загружает **настоящий WASM** и обрабатывает 300 блоков синтетических
гармоник/шума вентилятора/импульсов клавиатуры. Проверяются конечный PCM, амплитуда,
ненулевой выход и ограниченное время завершения. Материалы генерируются в тесте;
чужих записей речи в репозитории нет. Тест не измеряет субъективную разборчивость речи.
Браузерный тест запускает реальный AudioWorklet/WASM и отдельно запрещает компиляцию WASM тестовой CSP, проверяя Standard fallback. Windows/гарнитура требуют ручной проверки.

Ошибка инициализации Enhanced не должна оборвать звонок. Если браузер вообще
не поддерживает AudioWorklet/Web Audio/микрофон в secure context, Hub показывает
ошибку микрофона; полноценный обработанный вход требует современного Chromium.
