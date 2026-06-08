// Config editor — load/save the extension config in chrome.storage.local (key: 'config').
const ta = document.getElementById('cfg');
const status = document.getElementById('status');

chrome.storage.local.get('config').then(({ config }) => {
  ta.value = JSON.stringify(config || {}, null, 2);
});

document.getElementById('save').addEventListener('click', async () => {
  status.className = ''; status.textContent = '';
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { status.className = 'err'; status.textContent = 'Invalid JSON: ' + e.message; return; }
  await chrome.storage.local.set({ config: parsed });
  status.textContent = '✓ Saved';
  setTimeout(() => (status.textContent = ''), 2000);
});
