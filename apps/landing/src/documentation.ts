import './index.css';
const search = document.querySelector<HTMLInputElement>('[data-doc-search]');
if (search) {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('fr');
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-search]')];
  const count = document.querySelector<HTMLElement>('[data-doc-count]');
  const empty = document.querySelector<HTMLElement>('[data-doc-empty]');
  function update() {
    const query = normalize(search!.value);
    let visible = 0;
    for (const link of links) {
      const match = normalize(link.dataset.search ?? '').includes(query);
      link.hidden = !match;
      if (match) visible++;
    }
    if (count)
      count.textContent = `${visible} article${visible > 1 ? 's' : ''} · Mis à jour automatiquement avec le dépôt.`;
    if (empty) empty.hidden = visible > 0;
  }
  search.value = new URLSearchParams(window.location.search).get('q') ?? '';
  search.addEventListener('input', update);
  update();
}

// Load the app adaptation only when a reader explicitly opens an example.
for (const panel of document.querySelectorAll<HTMLDetailsElement>('[data-guide-demo]')) {
  let loaded = false;
  let loading = false;
  panel.addEventListener('toggle', async () => {
    if (!panel.open || loaded || loading) return;
    loading = true;
    const status = panel.querySelector<HTMLElement>('[data-guide-demo-status]');
    if (status) status.textContent = 'Chargement de l’aperçu…';
    try {
      const { mountGuidePreview } = await import('./components/guide-preview');
      mountGuidePreview(panel.querySelector('[data-guide-demo-root]')!, panel.dataset.guideDemo!);
      loaded = true;
      if (status) status.textContent = 'Aperçu prêt. Vous pouvez explorer l’écran ci-dessus.';
    } catch {
      if (status)
        status.textContent =
          'L’aperçu n’a pas pu se charger. Fermez puis rouvrez ce panneau pour réessayer ; les étapes restent disponibles.';
    } finally {
      loading = false;
    }
  });
}
