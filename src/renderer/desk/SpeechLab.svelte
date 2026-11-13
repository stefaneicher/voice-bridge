<script lang="ts">
  import type { LabCommand, LabReview, LabState } from '../../shared/speech-lab';
  import { settings } from '../lib/settings-store.svelte';

  let {
    state: lab,
    action,
  }: { state: LabState; action: (command: LabCommand) => Promise<boolean> } = $props();
  let expected = $state('Bitte prüfe den Pull Request und starte danach die Tests.');
  let cloudConsent = $state(false);
  let review = $state<LabReview>('unreviewed');
  let correction = $state('');
  let loadedId = $state('');
  let pending = $state(false);
  const busy = $derived(['starting', 'recording', 'finishing'].includes(lab.phase));
  const current = $derived(lab.current);
  const firstPreview = $derived(current?.previews.find((p) => p.text.trim())?.atMs);
  const labels = {
    unreviewed: 'Ungeprüft',
    correct: 'Korrekt',
    incorrect: 'Fehlerhaft',
  };

  $effect(() => {
    if (current?.id !== loadedId) {
      loadedId = current?.id ?? '';
      review = current?.review ?? 'unreviewed';
      correction = current?.correction ?? '';
    }
  });

  async function run(command: LabCommand) {
    pending = true;
    try {
      return await action(command);
    } finally {
      pending = false;
    }
  }

  async function save() {
    pending = true;
    try {
      if (await action({ type: 'review', review, correction })) {
        await action({ type: 'save', consent: true });
      }
    } finally {
      pending = false;
    }
  }

  function ms(value: number | undefined): string {
    return value === undefined ? '–' : `${Math.round(value)} ms`;
  }
</script>

<section class="lab" aria-label="Spracherkennungs-Testlabor">
  <h1>Spracherkennungs-Testlabor</h1>
  <p>
    Isolierter Test: keine Agent-Zustellung, kein Einfügen am Cursor. Globale Diktat- und
    Agent-Tasten sowie das Handy sind pausiert. Zum Schliessen zuerst das Testlabor verlassen.
  </p>
  <p class="notice">
    Cloud-Hinweis: Bei aktivierter Live-Erkennung wird Audio bereits während des Sprechens an die
    konfigurierte STT-API übertragen. Sonst oder bei Live-Fehlern wird die WAV-Aufnahme nach
    «Stoppen» übertragen. Eine aktivierte Hochdeutsch-Nachbearbeitung überträgt zusätzlich Text an
    die konfigurierte API. Es gelten die STT-Einstellungen dieses Profils. Kein weiterer Upload,
    keine Telemetrie.
  </p>
  <p>
    Standard: Audio, Text und Messwerte nur im RAM. Erst «Audio + Messdaten lokal speichern» erteilt
    die Zustimmung für genau diese Aufnahme. Gespeicherte Tests bleiben bis zum Löschen auf diesem
    PC. Export nur von einzeln ausgewählten Tests; nichts wird automatisch versendet.
  </p>

  {#if !current}
    {#if settings.data}
      <p class="notice">
        Aktuell: {settings.data.config.stt.live.enabled
          ? `Live an (${settings.data.config.stt.live.model}, ${settings.data.config.stt.live.delay})`
          : 'Live aus (Datei-Erkennung nach Stoppen)'} · Datei-Modell:
        {settings.data.config.stt.model} · Sprache: {settings.data.config.stt.language} · Nachbearbeitung:
        {settings.data.config.stt.polish.enabled ? 'an' : 'aus'}. Zum Ändern zuerst das Testlabor
        verlassen.
      </p>
    {/if}
    <label for="lab-example">Beispielsatz</label>
    <select
      id="lab-example"
      onchange={(e) => {
        if (e.currentTarget.value) expected = e.currentTarget.value;
      }}
    >
      <option value="">Eigenen Satz eingeben</option>
      <option>Bitte prüfe den Pull Request und starte danach die Tests.</option>
      <option>Am Donnerstag um vierzehn Uhr besprechen wir das neue Deployment.</option>
      <option>Chasch bitte de Pull Request prüefe und nacher d Tests starte?</option>
    </select>
    <label for="lab-expected">Erwarteter Text (bei Mundart: gewünschte Ausgabe festlegen)</label>
    <textarea id="lab-expected" rows="3" maxlength="2000" bind:value={expected}></textarea>
    <label class="consent">
      <input type="checkbox" bind:checked={cloudConsent} />
      Ich stimme der oben beschriebenen Cloud-Übertragung für diesen Test zu.
    </label>
    <div class="actions">
      <button
        disabled={pending || !expected.trim() || !cloudConsent}
        onclick={async () => {
          await run({ type: 'start', expected, cloudConsent });
          cloudConsent = false;
        }}>Aufnahme starten</button
      >
      <button disabled={pending} onclick={() => run({ type: 'exit' })}>Testlabor verlassen</button>
    </div>
  {:else}
    <p role="status">
      {lab.phase === 'starting'
        ? 'Mikrofon startet … Noch nicht sprechen.'
        : lab.phase === 'recording'
          ? 'Aufnahme läuft – Satz sprechen, dann stoppen (max. 120 Sekunden).'
          : lab.phase === 'capture-error'
            ? 'Audio konnte nicht abgeholt werden – erneuter Abruf möglich.'
            : lab.phase === 'finishing'
              ? 'Finale Erkennung läuft …'
              : lab.saved
                ? 'Test lokal gespeichert.'
                : 'Ergebnis nur im RAM – noch nicht gespeichert.'}
    </p>
    {#if lab.phase === 'recording' || lab.phase === 'capture-error'}
      <button disabled={pending} onclick={() => run({ type: 'stop' })}
        >{lab.phase === 'recording' ? 'Aufnahme stoppen' : 'Audio erneut abrufen'}</button
      >
    {/if}
    <h2>Erwartet</h2>
    <p class="transcript">{current.expected}</p>
    <h2>{busy ? 'Live-Vorschau' : 'Finaler Text'}</h2>
    <p class="transcript" aria-live="polite">
      {busy
        ? (current.previews.at(-1)?.text ?? 'Noch keine Vorschau')
        : current.finalText || '(leer)'}
    </p>
    {#if current.rawText}<h2>Rohtranskript</h2>
      <p>{current.rawText}</p>{/if}
    {#if current.error}<p role="alert">{current.error}</p>{/if}
    <p>
      Erste Vorschau: {ms(firstPreview)} · Stoppen: {ms(current.releasedAtMs)} · Final:
      {ms(current.finalAtMs)} · Stoppen → Final:
      {ms(
        current.finalAtMs !== undefined && current.releasedAtMs !== undefined
          ? current.finalAtMs - current.releasedAtMs
          : undefined,
      )}
    </p>
    <p class="muted">
      Alle Zeiten monoton ab Start-Anforderung (inkl. Mikrofonstart); keine Messung des
      Sprachbeginns. WAV-Dauer: {ms(current.durationMs)}.
    </p>
    {#if !busy}
      <label for="lab-review"
        >Korrektheit manuell beurteilen (keine automatische Mundart-Wertung)</label
      >
      <select id="lab-review" bind:value={review}>
        <option value="unreviewed">Ungeprüft</option>
        <option value="correct">Korrekt</option>
        <option value="incorrect">Fehlerhaft</option>
      </select>
      <label for="lab-correction">Korrigierter Text / Anmerkung (optional)</label>
      <textarea id="lab-correction" rows="2" maxlength="16000" bind:value={correction}></textarea>
      <div class="actions">
        <button disabled={pending || !lab.hasAudio} onclick={save}
          >Audio + Messdaten lokal speichern</button
        >
        <button
          disabled={pending || !lab.saved}
          onclick={() => run({ type: 'export', id: current.id })}
          >Gespeicherte Version exportieren …</button
        >
        <button disabled={pending} onclick={() => run({ type: 'discard' })}
          >RAM-Test verwerfen / Auswahl schliessen</button
        >
      </div>
      <p class="muted">
        Verwerfen löscht keine bereits gespeicherte Datei. Änderungen an der Bewertung werden erst
        mit «lokal speichern» übernommen.
      </p>
    {/if}
    <details>
      <summary>Vorschau-Verlauf ({current.previews.length}) und Ereignisse</summary>
      <ol>
        {#each current.previews as preview, index (index)}
          <li>{ms(preview.atMs)}: {preview.text || '(leer)'}</li>
        {/each}
      </ol>
      <ul>
        {#each current.events as event, index (index)}
          <li>{ms(event.atMs)}: {event.name}</li>
        {/each}
      </ul>
    </details>
    <details>
      <summary>STT-Einstellungen dieses Tests</summary>
      <pre>{JSON.stringify(current.settings, null, 2)}</pre>
    </details>
  {/if}

  <h2>Gespeicherte Tests ({lab.entries.length}/100)</h2>
  <p class="muted">
    Profil-lokal im Ordner «speech-lab». Export: eine portable JSON-Datei mit Messdaten und
    eingebettetem WAV (Base64, etwa 33 % grösser). Enthält Stimme, Texte und Einstellungen – nur
    bewusst weitergeben. Kein API-Key, keine Session-ID.
  </p>
  {#if lab.storageWarning}<p role="alert">{lab.storageWarning}</p>{/if}
  {#each lab.entries as entry (entry.id)}
    <article>
      <p>{new Date(entry.createdAt).toLocaleString('de-CH')} · {labels[entry.review]}</p>
      <p class="transcript">{entry.expected}</p>
      <div class="actions">
        <button
          disabled={pending || busy || !!current}
          onclick={() => run({ type: 'load', id: entry.id })}>Ansehen / Bewerten</button
        >
        <button disabled={pending || busy} onclick={() => run({ type: 'export', id: entry.id })}
          >Diesen Test exportieren …</button
        >
        <button disabled={pending || busy} onclick={() => run({ type: 'delete', id: entry.id })}
          >Audio + Messdaten endgültig löschen</button
        >
      </div>
    </article>
  {:else}
    <p>Noch keine Tests gespeichert.</p>
  {/each}
</section>

<style>
  .lab {
    padding: 20px;
    overflow: auto;
  }
  h1 {
    font-size: 20px;
  }
  h2 {
    margin-top: 20px;
    font-size: 15px;
  }
  p,
  li {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  label {
    display: block;
    margin: 12px 0 6px;
  }
  textarea,
  select {
    width: 100%;
    box-sizing: border-box;
    background: var(--vb-ink-2);
    color: var(--vb-text);
    border: 1px solid var(--vb-line);
    border-radius: 6px;
    padding: 8px;
  }
  button {
    background: var(--vb-ink-3);
    color: var(--vb-text);
    border: 1px solid var(--vb-line);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
  .notice,
  article,
  .transcript {
    padding: 10px;
    border: 1px solid var(--vb-line);
    border-radius: 6px;
    white-space: pre-wrap;
  }
  .notice {
    border-color: var(--vb-dictate);
  }
  .muted {
    color: var(--vb-text-3);
    font-size: 12px;
  }
  details {
    margin-top: 14px;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  article {
    margin-top: 10px;
  }
</style>
