// Обычный скрипт после модуля app.js: на iPhone без Mac ошибку иначе не увидеть, будет просто пустой экран.
// Ошибки загрузки модулей приходят на сам тег script, ошибки кода на window.
function showError(msg) {
  let el = document.getElementById('err');
  if (!el) el = document.body.appendChild(Object.assign(document.createElement('pre'), { id: 'err' }));
  el.textContent = `Ошибка: ${msg}. Закрой приложение полностью и открой снова.`;
}
document.querySelector('script[type=module]').addEventListener('error', () => showError('не загрузился код приложения'));
addEventListener('error', e => showError(e.message || 'неизвестная'));
addEventListener('unhandledrejection', e => showError(e.reason?.message || String(e.reason)));
