<script lang="ts">
  import { bindingLabel } from '../../core/bindings';
  import type { HotkeyAction, HotkeyBinding } from '../../core/types';
  import { STT_MODELS, type AppConfig } from '../../shared/config';
  import QRCode from 'qrcode';
  import type { RemoteData, SettingsData } from '../../shared/ipc';

  const SECTIONS = [
    ['general', 'Allgemein'],
    ['hotkeys', 'Hotkeys'],
    ['stt', 'Spracherkennung'],
    ['agents', 'Agents & Sessions'],
    ['phone', 'Handy'],
    ['privacy', 'Datenschutz'],
    ['citrix', 'Citrix'],
  ] as const;
  type Section = (typeof SECTIONS)[number][0];

  let data = $state<SettingsData | null>(null);
  let config = $state<AppConfig | null>(null);
  let section = $state<Section>('general');
  let apiKey = $state('');
  let glossary = $state('');
  let capturing = $state<HotkeyAction | null>(null);
  let notice = $state<{ ok: boolean; text: string } | null>(null);
  let saving = $state(false);
  let remote = $state<RemoteData | null>(null);
  let qr = $state<string | null>(null);

  async function showRemote(next: RemoteData) {
    remote = next;
    qr = next.pairingUri
      ? await QRCode.toDataURL(next.pairingUri, { margin: 1, width: 240 })
      : null;
  }

  $effect(() => {
    if (section === 'phone') void window.vb.getRemote().then(showRemote);
  });

  async function load() {
    data = await window.vb.getSettings();
    config = $state.snapshot(data.config);
    glossary = config.stt.glossary.join(', ');
  }
  void load();

  function flash(ok: boolean, text: string) {
    notice = { ok, text };
    setTimeout(() => (notice = null), 4000);
  }

  async function save() {
    if (!config) return;
    saving = true;
    try {
      config.stt.glossary = glossary
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);
      data = await window.vb.saveSettings($state.snapshot(config));
      if (section === 'phone') await showRemote(await window.vb.getRemote());
      config = $state.snapshot(data.config);
      flash(true, 'Gespeichert');
    } catch (err) {
      flash(false, `Speichern fehlgeschlagen: ${String(err)}`);
    } finally {
      saving = false;
    }
  }

  async function storeKey(remove = false) {
    try {
      data = await window.vb.setApiKey(remove ? null : apiKey);
      apiKey = '';
      flash(true, remove ? 'API-Key entfernt' : 'API-Key sicher gespeichert');
    } catch (err) {
      flash(false, String(err));
    }
  }

  async function capture(action: HotkeyAction) {
    if (!config) return;
    capturing = action;
    const raw = await window.vb.captureHotkey();
    capturing = null;
    if (!raw) return flash(false, 'Keine Taste erkannt');
    config.hotkeys[action] = raw as HotkeyBinding;
  }

  async function test() {
    const r = await window.vb.testConnection();
    flash(r.ok, r.message);
  }
</script>

<div class="settings">
  <nav>
    <div class="brand">Voice-Bridge</div>
    {#each SECTIONS as [id, label] (id)}
      <button class:active={section === id} onclick={() => (section = id)}>{label}</button>
    {/each}
    {#if data}
      <div class="version">Version {data.version}</div>
    {/if}
  </nav>

  <main>
    {#if !config || !data}
      <p>Lade …</p>
    {:else}
      {#if section === 'general'}
        <h1>Profil {config.profile}</h1>
        <p class="lead">
          Eigene Konfiguration, Secrets und Sessions je Profil. Ein anderes Profil startest du über
          das Tray-Menü oder mit <code>voice-bridge --profile citrix</code>.
        </p>
        {#if data.openAtLogin !== null}
          <div class="field">
            <label class="label" for="login">Beim Anmelden starten (dieses Profil)</label>
            <input
              id="login"
              type="checkbox"
              checked={data.openAtLogin}
              onchange={async (e) => {
                data = await window.vb.setOpenAtLogin(e.currentTarget.checked);
              }}
            />
          </div>
        {/if}
        <dl>
          <dt>Pipe für <code>vb run</code></dt>
          <dd><code>{data.pipePath}</code></dd>
          <dt>System</dt>
          <dd>{data.platform}</dd>
        </dl>
      {:else if section === 'hotkeys'}
        <h1>Hotkeys</h1>
        <p class="lead">
          Taste halten zum Sprechen, loslassen zum Senden. Auch Zusatztasten der Maus.
        </p>
        {#each [['dictate', 'Diktat', 'Text erscheint am Cursor, ohne Absenden'], ['agent', 'Agent', 'Prompt geht an die gewählte Session']] as const as [action, label, hint] (action)}
          <div class="field">
            <div>
              <div class="label">{label}</div>
              <div class="hint">{hint}</div>
            </div>
            <button class="key" onclick={() => capture(action)} disabled={capturing !== null}>
              {capturing === action ? 'Taste drücken …' : bindingLabel(config.hotkeys[action])}
            </button>
          </div>
        {/each}
        <div class="field">
          <label class="label" for="minhold">Mindestdauer (ms)</label>
          <input
            id="minhold"
            type="number"
            min="0"
            max="5000"
            bind:value={config.hotkeys.minHoldMs}
          />
        </div>
        <div class="field">
          <label class="label" for="maxrec">Maximale Aufnahme (s)</label>
          <input
            id="maxrec"
            type="number"
            min="5"
            max="600"
            bind:value={config.hotkeys.maxRecordingSec}
          />
        </div>
      {:else if section === 'stt'}
        <h1>Spracherkennung</h1>
        <p class="lead">
          Audio wird zur Transkription an OpenAI gesendet. Es wird lokal nicht gespeichert.
        </p>
        <div class="field">
          <label class="label" for="model">Modell</label>
          <select id="model" bind:value={config.stt.model}>
            {#each STT_MODELS as m (m)}<option value={m}>{m}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label class="label" for="dialect">Gesprochen</label>
          <input id="dialect" bind:value={config.stt.dialectHint} />
        </div>
        <div class="field">
          <label class="label" for="polish">Ausgabe als Hochdeutsch (CH, ss statt ß)</label>
          <input id="polish" type="checkbox" bind:checked={config.stt.polish.enabled} />
        </div>
        <div class="field">
          <label class="label" for="raw">Rohtranskript zusätzlich anzeigen</label>
          <input id="raw" type="checkbox" bind:checked={config.stt.showRawTranscript} />
        </div>
        <div class="field column">
          <label class="label" for="glossary">Glossar (Komma-getrennt)</label>
          <textarea id="glossary" rows="3" bind:value={glossary}></textarea>
        </div>
        <div class="field column">
          <label class="label" for="key">API-Key</label>
          <div class="hint">
            {#if !data.secureStorage}
              Sichere Ablage ist auf diesem System nicht verfügbar.
            {:else if data.hasApiKey}
              Gespeichert in der sicheren Ablage des Systems.
            {:else}
              Noch kein Key hinterlegt.
            {/if}
          </div>
          <div class="row">
            <input
              id="key"
              type="password"
              autocomplete="off"
              placeholder="sk-…"
              bind:value={apiKey}
            />
            <button class="btn" disabled={!apiKey || !data.secureStorage} onclick={() => storeKey()}
              >Speichern</button
            >
            {#if data.hasApiKey}
              <button class="btn ghost" onclick={() => storeKey(true)}>Entfernen</button>
              <button class="btn ghost" onclick={test}>Verbindung testen</button>
            {/if}
          </div>
        </div>
        <div class="field">
          <label class="label" for="baseurl">API-Adresse</label>
          <input id="baseurl" bind:value={config.stt.baseUrl} />
        </div>
      {:else if section === 'agents'}
        <h1>Agents & Sessions</h1>
        <p class="lead">
          Sessions erscheinen, wenn ein Agent mit <code>vb run -- copilot</code> gestartet wird. Es gibt
          keine stille Umleitung: fehlt die gewählte Session, bleibt der Text erhalten.
        </p>
        <div class="field">
          <label class="label" for="enter">Prompt sofort absenden (Enter)</label>
          <input id="enter" type="checkbox" bind:checked={config.agents.pressEnter} />
        </div>
        <div class="field">
          <label class="label" for="bp">Bracketed Paste (mehrzeilige Prompts)</label>
          <input id="bp" type="checkbox" bind:checked={config.agents.bracketedPaste} />
        </div>
        <p class="hint">Diese beiden Einstellungen gelten nach einem Neustart von Voice-Bridge.</p>
      {:else if section === 'phone'}
        <h1>Handy als Mikrofon</h1>
        <p class="lead">
          Mit der Voice-Bridge-App für Android sprichst du ins Handy, der Text erscheint auf diesem
          PC: am Cursor oder in der gewählten Session. Handy und PC müssen im selben WLAN sein.
        </p>
        <div class="field">
          <label class="label" for="remote">Verbindungen vom Handy erlauben</label>
          <input id="remote" type="checkbox" bind:checked={config.remote.enabled} />
        </div>
        <div class="field">
          <label class="label" for="rport">Port</label>
          <input id="rport" type="number" min="1024" max="65535" bind:value={config.remote.port} />
        </div>
        {#if remote}
          {#if remote.error}
            <p class="hint bad">{remote.error}</p>
          {:else if remote.running}
            <div class="field column">
              <div class="label">Handy koppeln</div>
              <div class="hint">
                In der App «QR-Code scannen» wählen. Der Code gilt 10 Minuten und nur für ein Gerät.
              </div>
              {#if qr}
                <img class="qr" src={qr} alt="QR-Code zum Koppeln" width="240" height="240" />
                <div class="hint">
                  Erreichbar unter {remote.hosts.join(', ')} · Port {remote.port}
                </div>
              {:else if !remote.hosts.length}
                <p class="hint bad">Kein Netzwerk gefunden. Ist der PC mit dem WLAN verbunden?</p>
              {/if}
              <div class="row">
                <button class="btn" onclick={() => window.vb.newPairingCode().then(showRemote)}>
                  {qr ? 'Neuen Code erzeugen' : 'QR-Code anzeigen'}
                </button>
              </div>
            </div>
            <div class="field column">
              <div class="label">Gekoppelte Geräte</div>
              {#each remote.devices as d (d.id)}
                <div class="row">
                  <span>{d.name}</span>
                  <span class="hint">
                    {d.lastSeen
                      ? `zuletzt ${new Date(d.lastSeen).toLocaleString('de-CH')}`
                      : 'noch nie verbunden'}
                  </span>
                  <button
                    class="btn ghost"
                    onclick={() => window.vb.removeDevice(d.id).then(showRemote)}
                  >
                    Entfernen
                  </button>
                </div>
              {:else}
                <div class="hint">Noch kein Handy gekoppelt.</div>
              {/each}
            </div>
          {:else}
            <p class="hint">Einschalten und speichern, dann erscheint hier der QR-Code.</p>
          {/if}
        {/if}
        <p class="hint">
          Windows fragt beim ersten Start, ob Voice-Bridge Verbindungen im privaten Netzwerk
          annehmen darf: mit «Zulassen» bestätigen. Die Verbindung ist verschlüsselt; die App
          vertraut nur diesem PC.
        </p>
      {:else if section === 'privacy'}
        <h1>Datenschutz</h1>
        <div class="field">
          <label class="label" for="cloud">Cloud-Transkription erlauben</label>
          <input id="cloud" type="checkbox" bind:checked={config.privacy.cloudAllowed} />
        </div>
        <div class="field">
          <label class="label" for="prewarm">Mikrofon offen halten (schnellerer Start)</label>
          <input id="prewarm" type="checkbox" bind:checked={config.audio.prewarm} />
        </div>
        <div class="field">
          <label class="label" for="hist">Verlauf (Anzahl Einträge, 0 = aus)</label>
          <input
            id="hist"
            type="number"
            min="0"
            max="1000"
            bind:value={config.privacy.historyEntries}
          />
        </div>
        <button
          class="btn ghost"
          onclick={() => window.vb.clearHistory().then(() => flash(true, 'Verlauf gelöscht'))}
          >Verlauf löschen</button
        >
        <p class="hint">
          Audio wird nur im Arbeitsspeicher gehalten und nach der Transkription verworfen. Bei einem
          Fehler bleibt es, bis du die Meldung schliesst. Kein Telemetrie-Code.
        </p>
      {:else if section === 'citrix'}
        <h1>Citrix</h1>
        <p class="lead">
          Für Citrix ein eigenes Profil verwenden: <code>voice-bridge --profile citrix</code> und
          <code>vb run --profile citrix -- copilot</code>.
        </p>
        <p class="hint">
          Zu prüfen sind Hotkeys, Mikrofon-Umleitung, Erreichbarkeit von api.openai.com und das
          Einfügen. Testprotokoll: docs/citrix.md im Repository.
        </p>
      {/if}

      {#if section !== 'citrix'}
        <footer>
          {#if notice}<span class="notice" class:bad={!notice.ok}>{notice.text}</span>{/if}
          <button class="btn primary" onclick={save} disabled={saving}>Speichern</button>
        </footer>
      {/if}
    {/if}
  </main>
</div>

<style>
  :global(html[data-view='settings']),
  :global(html[data-view='settings'] body) {
    background: var(--vb-light-bg);
    color: #1d2128;
    height: 100%;
  }
  .settings {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100vh;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 20px 12px;
    border-right: 1px solid #e6e6e1;
    background: #f3f3ef;
  }
  .brand {
    font: 600 18px var(--font-title);
    padding: 0 10px 16px;
  }
  nav button {
    text-align: left;
    padding: 9px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font: 500 14px var(--font-ui);
    color: #3b414c;
    cursor: pointer;
  }
  nav button.active {
    background: #fff;
    color: var(--vb-light-accent);
    box-shadow: 0 0 0 1px #e6e6e1;
  }
  .version {
    margin-top: auto;
    padding: 10px;
    font-size: 12px;
    color: #6b7280;
  }
  main {
    padding: 32px 40px;
    max-width: 760px;
  }
  h1 {
    font: 600 24px var(--font-title);
    margin: 0 0 6px;
  }
  .lead {
    color: #4b5260;
    margin: 0 0 24px;
    line-height: 1.5;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
    border-bottom: 1px solid #ecece7;
  }
  .field.column {
    flex-direction: column;
    align-items: stretch;
  }
  .label {
    font-weight: 500;
    font-size: 14px;
  }
  .hint {
    font-size: 13px;
    color: #6b7280;
  }
  input:not([type='checkbox']),
  select,
  textarea {
    font: 14px var(--font-ui);
    padding: 8px 10px;
    border: 1px solid #d6d6d0;
    border-radius: 8px;
    background: #fff;
    min-width: 240px;
  }
  input[type='checkbox'] {
    width: 18px;
    height: 18px;
    accent-color: var(--vb-light-accent);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .row input {
    flex: 1;
  }
  .key {
    font: 500 13px var(--font-mono);
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #d6d6d0;
    background: #fff;
    cursor: pointer;
    min-width: 160px;
  }
  .btn {
    font: 500 14px var(--font-ui);
    padding: 9px 16px;
    border-radius: 18px;
    border: 1px solid var(--vb-light-accent);
    background: var(--vb-light-accent);
    color: #fff;
    cursor: pointer;
  }
  .btn.ghost {
    background: transparent;
    color: var(--vb-light-accent);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 16px;
    margin-top: 28px;
  }
  .notice {
    font-size: 13px;
    color: var(--vb-light-accent);
  }
  .hint.bad {
    color: #b42318;
  }
  .qr {
    display: block;
    margin: 12px 0;
    border-radius: 8px;
    border: 1px solid #e6e6e1;
    image-rendering: pixelated;
  }
  .notice.bad {
    color: #b42318;
  }
  code {
    font-family: var(--font-mono);
    font-size: 13px;
    background: #efefea;
    padding: 1px 5px;
    border-radius: 4px;
  }
  dl {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 10px;
  }
  dt {
    color: #6b7280;
  }
  dd {
    margin: 0;
  }
</style>
