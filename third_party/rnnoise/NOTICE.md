# RNNoise в Hub

- DSP upstream: https://github.com/xiph/rnnoise
- Commit: `70f1d256acd4b34a572f999a05c87bf00b67730d`.
- Лицензия DSP/встроенной модели: BSD-3-Clause, полный текст RNNOISE-LICENSE.
- WASM wrapper: https://github.com/shiguredo/rnnoise-wasm, npm
  `@shiguredo/rnnoise-wasm@2025.1.5`, Apache-2.0 (WRAPPER-LICENSE).
- npm integrity зафиксирован настоящим package-lock.json.
- SHA-256 исходного `dist/rnnoise.js`:
  `e6958293a0118bf9860cb2753332f7562531cc987c914552c426cd7d7180a63e`.

Обёртка выбранного релиза использует Emscripten 4.0.8, upstream commit выше,
`-O2`, single-file WASM с встроенной моделью. Официальный рецепт:
https://github.com/shiguredo/rnnoise-wasm/blob/2025.1.5/build-rnnoise.sh
Сборка: checkout этого тега, Emscripten 4.0.8, autoconf/automake/libtool,
`./build-rnnoise.sh`, затем сборка JS обёртки по package.json upstream.
Hub использует проверенный опубликованный артефакт; локальная пересборка C/WASM
в текущем этапе не выполнялась. Для приложения достаточно npm ci и desktop:build.

Изменение Hub: scripts/prepare-rnnoise.mjs сначала проверяет SHA-256, затем
заменяет единственную проверку browser/WorkerGlobalScope на проверку наличия
WebAssembly. Это допускает AudioWorkletGlobalScope и Node offline harness:
выбранный single-file wrapper не использует DOM или внешнюю загрузку модели.
DSP/модель/WASM байты не меняются. В AudioWorklet добавлен JS atob fallback
для инициализации embedded WASM; PCM обрабатывает исходный RNNoise.
Сгенерированный rnnoise.generated.js не коммитится; Vite включает его только в
отдельный enhanced-worklet asset, который загружается при выборе RNNoise.

Шигуредо публикует изменения и исходный build script; проект имеет ограниченную
поддержку на японском языке. Версия закреплена намеренно, обновление требует
повторной проверки лицензии, provenance и аудиотестов. Не используем случайный
wrapper без исходников и не загружаем модели с CDN. GPL DSP-компонентов нет.
