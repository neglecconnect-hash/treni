// Обычный скрипт после модуля app.js: на iPhone без Mac ошибку иначе не увидеть, будет просто пустой экран.
// Ошибки загрузки модулей приходят на сам тег script, ошибки кода на window.
function showError(msg) {
  let el = document.getElementById('err');
  if (!el) el = document.body.appendChild(Object.assign(document.createElement('pre'), { id: 'err' }));
  el.textContent = `Ошибка: ${msg}. Закрой приложение полностью и открой снова.`;
}
document.querySelector('script[type=module]').addEventListener('error', () => showError('не загрузился код приложения'));
// Только ошибки наших файлов. «Script error.» без файла бросают чужие скрипты: меню «Поделиться» Safari,
// добавление на экран «Домой», расширения. Приложению они не мешают, пугать ими не надо
const ours = s => String(s || '').startsWith(location.origin);
addEventListener('error', e => { if (ours(e.filename)) showError(e.message || 'неизвестная'); });
addEventListener('unhandledrejection', e => { if (ours(e.reason?.stack?.match(/https?:\/\/\S+/)?.[0])) showError(e.reason.message); });
