/* Optional controller UI. No OpenAI/GitHub/mail secrets and no background timer. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let config = null, revision = null, selectedReport = null, selectedRevision = null, editingId = null;
  let controller = '', token = '', poll = null;
  const pendingJobs = new Map();
  function watchJob(data, label) { if (data.workflow_id) pendingJobs.set(data.workflow_id, { label, runId: data.run_id }); }
  const defaults = () => ({ version: 1, mode: 'manual', profiles: [
    ['daily', '24 Stunden', 'daily'], ['twoDay', '48 Stunden', '48h'], ['weekly', '7 Tage', 'weekly']
  ].map(([id, name, cadence]) => ({ id, name, enabled: false, preset: id, language: 'both', model: 'gpt-6.1-sol',
    region: $('region').value, audience: 'OSINT-Analyst', mapMode: 'auto', recipients: [],
    topics: ['hybrid', 'shadow', 'drugs', 'iuu', 'cyber', 'safety', 'economic', 'ukmto', 'authorities', 'maritimeExecutive', 'gcaptain', 'vesseltracker'],
    schedule: { cadence, timezone: 'Europe/Berlin', time: '07:00', anchorDate: todayISO() } })) });
  function status(message, bad = false) { $('automationStatus').textContent = message; $('automationStatus').style.color = bad ? '#ffb8b8' : '#b8ffc4'; }
  async function api(path, method = 'GET', body) {
    if (!token) throw new Error('Zuerst mit dem HonkyTonk-Controller verbinden.');
    const response = await fetch(controller + '/api/' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Controller HTTP ' + response.status);
    return data;
  }
  const profile = () => config?.profiles.find(p => p.id === $('automationProfile').value);
  function fillProfileList(id) {
    const selector = $('automationProfile'); selector.replaceChildren();
    for (const p of config.profiles) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; selector.append(opt); }
    if (id) selector.value = id;
    $('automationMode').value = config.mode;
    fillProfile();
  }
  function fillProfile() {
    const p = profile(); if (!p) return;
    editingId = p.id;
    for (const [id, value] of Object.entries({ automationName: p.name, automationPreset: p.preset, automationLanguage: p.language, automationModel: p.model, automationRegion: p.region, automationAudience: p.audience, automationMap: p.mapMode, automationRecipients: p.recipients.join('\n'), automationCadence: p.schedule.cadence, automationTime: p.schedule.time, automationTimezone: p.schedule.timezone, automationAnchor: p.schedule.anchorDate, automationTopics: p.topics.join(', ') })) $(id).value = value;
    $('automationEnabled').checked = p.enabled;
  }
  function collectProfile() {
    const p = config?.profiles.find(p => p.id === editingId); if (!p) return;
    Object.assign(p, { name: $('automationName').value.trim(), preset: $('automationPreset').value, language: $('automationLanguage').value,
      model: $('automationModel').value, region: $('automationRegion').value.trim(), audience: $('automationAudience').value, mapMode: $('automationMap').value,
      enabled: $('automationEnabled').checked, recipients: [...new Set($('automationRecipients').value.split(/[\n,;]/).map(s => s.trim()).filter(Boolean))], topics: $('automationTopics').value.split(',').map(s => s.trim()).filter(Boolean),
      schedule: { cadence: $('automationCadence').value, timezone: $('automationTimezone').value.trim(), time: $('automationTime').value, anchorDate: $('automationAnchor').value } });
    config.mode = $('automationMode').value;
  }
  async function refreshRuns() {
    for (const [id, job] of pendingJobs) {
      const progress = await api('jobs/' + id);
      if (['complete', 'completed'].includes(progress.status)) { pendingJobs.delete(id); status(job.label + ' abgeschlossen. Archivierten Bericht und Status neu prüfen.'); }
      else if (['errored', 'terminated'].includes(progress.status)) { pendingJobs.delete(id); status(job.label + ' angehalten: ' + (progress.error || progress.status), true); }
    }
    const data = await api('runs'), list = $('automationRuns'); list.replaceChildren();
    for (const run of data.runs) {
      const row = document.createElement('div'); row.className = 'item';
      const description = document.createElement('span'); description.textContent = `${run.profile.name} · ${run.window.report_date} · ${run.status}${run.error ? ' · ' + run.error : ''}`; row.append(description);
      if (run.report_path) { const button = document.createElement('button'); button.textContent = 'Bericht prüfen'; button.addEventListener('click', () => act(async () => {
        const entry = await api('reports/' + run.id); selectedReport = entry.report; selectedRevision = entry.revision;
        applyPayload(entry.report.payload, entry.report.profile, entry.report.profile.language === 'en' ? 'en' : 'de');
        $('automationDraftJson').value = JSON.stringify(entry.report.payload, null, 2);
        $('automationDraftInfo').textContent = `${run.id} · ${entry.report.profile.language} · Verteiler: ${entry.report.profile.recipients.join(', ') || 'leer'} · ${run.status}`;
        $('automationRelease').disabled = !['awaiting_review', 'ready'].includes(run.status) || [...pendingJobs.values()].some(job => job.runId === run.id);
        status('Archivierten Bericht geladen. Entwurf und Verteiler vor Freigabe prüfen.');
      })); row.append(button); }
      list.append(row);
    }
    if (!data.runs.length) list.textContent = 'Noch keine Hintergrundberichte.';
  }
  async function act(fn) { try { await fn(); } catch (error) { status(error.message, true); } }
  function applyPayload(payload, p, language = 'de') {
    // Shared manual rendering, with exact original CSS, logo, map and print code.
    $('reportDate').value = payload.meta.report_date;
    $('period').value = payload.meta.period;
    $('region').value = p.region; $('audience').value = p.audience; $('mapMode').value = p.mapMode; $('outputLanguage').value = language;
    reportMeta = structuredClone(payload.meta); imports = [];
    reports = payload.items.map(item => {
      const report = fromAiObj(item);
      if (report) { report.ht_automation = true; report.places = structuredClone(item.places); }
      return report;
    }).filter(Boolean);
    $('aiOutput').value = JSON.stringify(payload, null, 2); $('jsonOutputBox').value = JSON.stringify(payload, null, 2);
    updatePrompt(); renderImports(); renderEditor(); renderReport();
  }
  window.HonkyTonkAutomation = { applyPayload };
  config = defaults(); fillProfileList();
  $('automationConnect').addEventListener('click', () => act(async () => {
    const input = $('automationEndpoint').value.trim();
    if (input) {
      const url = new URL(input);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Controller benötigt HTTPS; lokal ist HTTP erlaubt.');
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Nur die Controller-Origin ohne Pfad oder Zugangsdaten eintragen.');
      controller = url.origin;
    } else controller = location.origin;
    token = $('automationAdminToken').value.trim();
    const loaded = await api('config'); config = loaded.config; revision = loaded.revision; fillProfileList();
    await refreshRuns();
    status('Verbunden. Der gespeicherte Modus steuert den Hintergrunddienst; Standard ist Manuell.');
    clearInterval(poll);
    // Polling shows progress only; all scheduled work is performed server-side.
    poll = setInterval(() => { if ($('automationDetails').open) act(refreshRuns); }, 15000);
  }));
  $('automationDisconnect').addEventListener('click', () => { token = ''; $('automationAdminToken').value = ''; clearInterval(poll); pendingJobs.clear(); status('Verbindung getrennt. Der gespeicherte Servermodus bleibt aktiv. Zum Pausieren Manuell speichern.'); });
  $('automationProfile').addEventListener('change', () => { collectProfile(); fillProfile(); });
  $('automationAdd').addEventListener('click', () => { collectProfile(); const p = structuredClone(profile() || defaults().profiles[0]); p.id = 'profile-' + crypto.randomUUID().slice(0, 8); p.name = 'Neue Ausgabe'; p.enabled = false; p.recipients = []; config.profiles.push(p); fillProfileList(p.id); });
  $('automationSave').addEventListener('click', () => act(async () => { collectProfile(); const saved = await api('config', 'PUT', { config, revision }); config = saved.config; revision = saved.revision; fillProfileList(profile()?.id); status(config.mode === 'manual' ? 'Manuell gespeichert: automatische Recherche und Versand pausiert.' : 'Automatikprofile auf dem Controller gespeichert.'); }));
  $('automationPreview').addEventListener('click', () => act(async () => { const data = await api('preview', 'POST', { profile_id: profile().id }); $('automationPlan').textContent = JSON.stringify(data, null, 2); status('Plan ohne KI-Aufruf und ohne Versand erstellt. Er verwendet das zuletzt gespeicherte Profil.'); }));
  $('automationRun').addEventListener('click', () => act(async () => { const data = await api('run', 'POST', { profile_id: profile().id }); watchJob(data, 'Entwurf'); status(data.workflow_id || data.status === 'started' ? 'Entwurf im Hintergrund gestartet. Er wird erst nach Freigabe versandt.' : 'Geplante Ausgabe bereits vorhanden: ' + data.status + '. Bericht im Archiv prüfen.'); await refreshRuns(); }));
  $('automationRetry').addEventListener('click', () => act(async () => { const data = await api('run', 'POST', { profile_id: profile().id, retry: true }); watchJob(data, 'Wiederholung'); status('Wiederholung angefordert; gespeicherte Recherche wird wiederverwendet. Status im Archiv prüfen.'); }));
  $('automationArchiveImports').addEventListener('click', () => act(async () => { const data = await api('sources', 'POST', { profile_id: profile().id, items: imports }); status(`${data.saved} White-Lightning-Blöcke archiviert; ${data.rejected.length} zurückgewiesen.${data.rejected.length ? ' ' + data.rejected.map(r => r.item + ': ' + r.reason).join(' | ') : ''}`); }));
  $('automationRefresh').addEventListener('click', () => act(refreshRuns));
  $('automationDraftJson').addEventListener('input', () => { $('automationRelease').disabled = true; status('JSON geändert. Entwurf speichern und neu gerenderte Ausgabe prüfen.'); });
  $('automationDraftSave').addEventListener('click', () => act(async () => {
    if (!selectedReport) throw new Error('Zuerst einen Hintergrundbericht laden.');
    const payload = JSON.parse($('automationDraftJson').value), entry = await api('reports/' + selectedReport.id, 'PUT', { payload, revision: selectedRevision });
    if (entry.workflow_id) { watchJob(entry, 'Entwurfsänderung'); selectedReport = null; selectedRevision = null; $('automationRelease').disabled = true; status('Änderung im Hintergrund gestartet. Danach Bericht erneut laden und Exporte prüfen.'); await refreshRuns(); return; }
    selectedReport = entry.report; selectedRevision = entry.revision;
    applyPayload(entry.report.payload, entry.report.profile, entry.report.profile.language === 'en' ? 'en' : 'de');
    status('Entwurf validiert, Exporte neu erstellt. Ausgabe vor Freigabe prüfen.'); await refreshRuns();
  }));
  $('automationRelease').addEventListener('click', () => act(async () => {
    if (!selectedReport || $('automationDraftJson').value !== JSON.stringify(selectedReport.payload, null, 2)) throw new Error('Entwurf geändert; vor Freigabe speichern und erneut laden.');
    const result = await api('release', 'POST', { run_id: selectedReport.id, revision: selectedRevision }); watchJob(result, 'Versand');
    $('automationRelease').disabled = true; status(result.workflow_id ? 'Freigabe im Hintergrund gestartet. Versandstatus im Archiv prüfen.' : 'Freigegebene Ausgabe an ihren gespeicherten Verteiler versandt.'); await refreshRuns();
  }));
})();
