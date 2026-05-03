/**
 * iQuantum — main UI controller
 * Top-tier search experience: debounce, keyboard shortcuts, filter chips,
 * skeleton loading, smart pagination, clickable tags, favicons.
 */

document.addEventListener('DOMContentLoaded', async () => {
    /* -------------------- Element references -------------------- */
    const $ = (id) => document.getElementById(id);

    const resourcesContainer = $('resources-container');
    const resourceCount = $('resource-count');
    const resultsContext = $('results-context');
    const heroSummary = $('hero-summary');

    const searchBar = document.querySelector('.search-bar');
    const searchInput = $('search');
    const searchClear = $('search-clear');

    const categoryFilter = $('category-filter');
    const listFilter = $('list-filter');
    const resetFiltersBtn = $('reset-filters');
    const activeFilters = $('active-filters');

    const sortBySelect = $('sort-by');
    const pageSizeSelect = $('page-size');

    const viewGridBtn = $('view-grid');
    const viewListBtn = $('view-list');

    const prevPageBtn = $('prev-page');
    const nextPageBtn = $('next-page');
    const pageNumbers = $('page-numbers');
    const pageInfoSpan = $('page-info');

    const backToTopBtn = $('back-to-top');

    /* -------------------- State -------------------- */
    let resources = [];
    let filteredResources = [];
    let categories = [];
    let listNames = [];
    let currentView = 'grid';        // 'grid' | 'list'
    let currentPage = 1;
    let pageSize = 25;
    let totalPages = 1;
    let fuseInstance = null;
    let searchDebounce = null;

    /* -------------------- Helpers -------------------- */
    const escapeHTML = (str = '') =>
        String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function highlightMatches(text, term) {
        const safe = escapeHTML(text);
        if (!term) return safe;
        const re = new RegExp(`(${escapeRegex(term)})`, 'gi');
        return safe.replace(re, '<mark class="highlight">$1</mark>');
    }

    function getDomain(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch { return ''; }
    }

    function faviconURL(url) {
        const domain = getDomain(url);
        if (!domain) return '';
        return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
    }

    function debounce(fn, wait) {
        return (...args) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => fn(...args), wait);
        };
    }

    /* -------------------- Initialize -------------------- */
    try {
        const data = await dataProcessor.init();
        resources = data.resources;
        filteredResources = [...resources];
        categories = data.categories;
        listNames = data.listNames;

        pageSize = parseInt(pageSizeSelect.value, 10) || 25;

        initializeFuseSearch();
        populateFilterDropdowns();
        updateHeroSummary();

        renderResources();
        setupEventListeners();
        loadLastUpdateTime();
    } catch (error) {
        console.error('Error initializing app:', error);
        resourcesContainer.classList.remove('resources-grid');
        resourcesContainer.innerHTML = `
            <div class="error-state" role="alert">
                <i class="fas fa-exclamation-triangle me-2" aria-hidden="true"></i>
                Couldn't load resources. Please refresh and try again.
            </div>
        `;
    }

    /* -------------------- Population -------------------- */
    function populateFilterDropdowns() {
        const frag1 = document.createDocumentFragment();
        categories.forEach((c) => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            frag1.appendChild(opt);
        });
        categoryFilter.appendChild(frag1);

        const frag2 = document.createDocumentFragment();
        listNames.forEach((l) => {
            const opt = document.createElement('option');
            opt.value = l; opt.textContent = l;
            frag2.appendChild(opt);
        });
        listFilter.appendChild(frag2);
    }

    function updateHeroSummary() {
        if (!heroSummary) return;
        const total = resources.length.toLocaleString();
        const lists = listNames.length;
        const cats = categories.length;
        heroSummary.innerHTML = `Search <strong>${total}</strong> curated resources across <strong>${lists}</strong> lists and <strong>${cats}</strong> categories.`;
    }

    /* -------------------- Event listeners -------------------- */
    function setupEventListeners() {
        // Search (debounced)
        const debouncedFilter = debounce(() => {
            searchBar.classList.remove('is-loading');
            filterResources();
        }, 180);
        searchInput.addEventListener('input', () => {
            searchBar.classList.add('is-loading');
            searchClear.hidden = !searchInput.value;
            debouncedFilter();
        });

        // Clear search
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.hidden = true;
            searchBar.classList.remove('is-loading');
            searchInput.focus();
            filterResources();
        });

        // Dropdowns
        categoryFilter.addEventListener('change', filterResources);
        listFilter.addEventListener('change', filterResources);
        sortBySelect.addEventListener('change', () => { sortResources(); renderResources(); });
        pageSizeSelect.addEventListener('change', () => {
            pageSize = parseInt(pageSizeSelect.value, 10);
            currentPage = 1;
            renderResources();
        });

        // Reset
        resetFiltersBtn.addEventListener('click', resetFilters);

        // View toggle
        viewGridBtn.addEventListener('click', () => setView('grid'));
        viewListBtn.addEventListener('click', () => setView('list'));

        // Pagination
        prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
        nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // ⌘K / Ctrl+K — focus search
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
                return;
            }
            // / — focus search when not typing
            if (e.key === '/' && document.activeElement !== searchInput && !e.metaKey && !e.ctrlKey) {
                const tag = (document.activeElement?.tagName || '').toLowerCase();
                if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                    e.preventDefault();
                    searchInput.focus();
                }
            }
            // ESC — clear search when focused
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                if (searchInput.value) {
                    searchInput.value = '';
                    searchClear.hidden = true;
                    filterResources();
                }
                searchInput.blur();
            }
        });

        // Back to top
        window.addEventListener('scroll', () => {
            const show = window.scrollY > 600;
            backToTopBtn.hidden = false;
            backToTopBtn.classList.toggle('is-visible', show);
        }, { passive: true });
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Delegate clicks for tags / meta pills
        resourcesContainer.addEventListener('click', (e) => {
            const tag = e.target.closest('[data-filter-tag]');
            if (tag) {
                searchInput.value = tag.dataset.filterTag;
                searchClear.hidden = false;
                filterResources();
                window.scrollTo({ top: searchBar.offsetTop, behavior: 'smooth' });
                return;
            }
            const cat = e.target.closest('[data-filter-category]');
            if (cat) {
                categoryFilter.value = cat.dataset.filterCategory;
                filterResources();
                return;
            }
            const list = e.target.closest('[data-filter-list]');
            if (list) {
                listFilter.value = list.dataset.filterList;
                filterResources();
            }
        });
    }

    /* -------------------- Search / filter / sort -------------------- */
    function initializeFuseSearch() {
        fuseInstance = new Fuse(resources, {
            keys: [
                { name: 'name', weight: 2.2 },
                { name: 'tags', weight: 1.5 },
                { name: 'description', weight: 1 },
                { name: 'category', weight: 0.8 },
                { name: 'list', weight: 0.6 }
            ],
            includeScore: true,
            threshold: 0.38,
            distance: 120,
            minMatchCharLength: 2,
            shouldSort: true,
            useExtendedSearch: true,
            ignoreLocation: true
        });
    }

    function filterResources() {
        const term = searchInput.value.trim();
        const cat = categoryFilter.value;
        const list = listFilter.value;

        let results = term
            ? fuseInstance.search(term).map((r) => r.item)
            : [...resources];

        filteredResources = results.filter((r) => {
            const okCat = cat === 'all' || r.category === cat;
            const okList = list === 'all' || r.list === list;
            return okCat && okList;
        });

        if (sortBySelect.value && !term) sortResources();

        currentPage = 1;
        renderResources();
        renderActiveChips();
    }

    function sortResources() {
        const by = sortBySelect.value;
        filteredResources.sort((a, b) => {
            switch (by) {
                case 'name': return a.name.localeCompare(b.name);
                case 'category': return a.category.localeCompare(b.category);
                case 'list': return a.list.localeCompare(b.list);
                default: return 0;
            }
        });
    }

    function resetFilters() {
        searchInput.value = '';
        searchClear.hidden = true;
        categoryFilter.value = 'all';
        listFilter.value = 'all';
        sortBySelect.value = 'name';
        filteredResources = [...resources];
        sortResources();
        currentPage = 1;
        renderResources();
        renderActiveChips();
    }

    /* -------------------- Active filter chips -------------------- */
    function renderActiveChips() {
        const chips = [];
        const term = searchInput.value.trim();
        if (term) chips.push({ label: 'Search', value: term, kind: 'search' });
        if (categoryFilter.value !== 'all') chips.push({ label: 'Category', value: categoryFilter.value, kind: 'category' });
        if (listFilter.value !== 'all') chips.push({ label: 'List', value: listFilter.value, kind: 'list' });

        activeFilters.innerHTML = chips.map((c) => `
            <span class="chip" data-kind="${c.kind}">
                <span class="chip__label">${c.label}:</span>
                <span class="chip__value">${escapeHTML(c.value)}</span>
                <button type="button" aria-label="Remove ${c.label} filter ${escapeHTML(c.value)}">
                    <i class="fas fa-times" aria-hidden="true"></i>
                </button>
            </span>
        `).join('');

        activeFilters.querySelectorAll('.chip button').forEach((btn) => {
            btn.addEventListener('click', () => {
                const kind = btn.parentElement.dataset.kind;
                if (kind === 'search') { searchInput.value = ''; searchClear.hidden = true; }
                if (kind === 'category') categoryFilter.value = 'all';
                if (kind === 'list') listFilter.value = 'all';
                filterResources();
            });
        });
    }

    /* -------------------- View / pagination -------------------- */
    function setView(view) {
        currentView = view;
        viewGridBtn.classList.toggle('is-active', view === 'grid');
        viewListBtn.classList.toggle('is-active', view === 'list');
        viewGridBtn.setAttribute('aria-pressed', view === 'grid');
        viewListBtn.setAttribute('aria-pressed', view === 'list');
        resourcesContainer.classList.toggle('is-list', view === 'list');
    }

    function goToPage(page) {
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        renderResources();
        const target = document.querySelector('.results-meta');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function buildPageNumbers() {
        pageNumbers.innerHTML = '';
        if (totalPages <= 1) return;

        const add = (n) => {
            const btn = document.createElement('button');
            btn.className = 'page-num' + (n === currentPage ? ' is-active' : '');
            btn.type = 'button';
            btn.textContent = n;
            btn.setAttribute('aria-label', `Go to page ${n}`);
            if (n === currentPage) btn.setAttribute('aria-current', 'page');
            btn.addEventListener('click', () => goToPage(n));
            pageNumbers.appendChild(btn);
        };
        const ellipsis = () => {
            const span = document.createElement('span');
            span.className = 'page-ellipsis';
            span.textContent = '…';
            pageNumbers.appendChild(span);
        };

        // Smart pagination: 1 ... 4 5 [6] 7 8 ... N
        const window_ = 1;
        const pages = new Set([1, totalPages, currentPage]);
        for (let i = 1; i <= window_; i++) {
            pages.add(currentPage - i);
            pages.add(currentPage + i);
        }
        const sorted = [...pages].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
        let prev = 0;
        sorted.forEach((n) => {
            if (prev && n - prev > 1) ellipsis();
            add(n);
            prev = n;
        });
    }

    /* -------------------- Render -------------------- */
    function renderResources() {
        const total = filteredResources.length;
        resourceCount.textContent = total.toLocaleString();
        totalPages = Math.max(1, Math.ceil(total / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;

        // context phrase
        const term = searchInput.value.trim();
        const cat = categoryFilter.value;
        const list = listFilter.value;
        const ctx = [];
        if (term) ctx.push(`for “${escapeHTML(term)}”`);
        if (cat !== 'all') ctx.push(`in ${escapeHTML(cat)}`);
        if (list !== 'all') ctx.push(`from ${escapeHTML(list)}`);
        resultsContext.innerHTML = ctx.length ? `· ${ctx.join(' ')}` : '';

        // pagination buttons
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        pageInfoSpan.textContent = totalPages > 1 ? `Page ${currentPage} of ${totalPages}` : '';
        buildPageNumbers();

        // clear container
        resourcesContainer.classList.add('resources-grid');
        resourcesContainer.classList.toggle('is-list', currentView === 'list');
        resourcesContainer.removeAttribute('aria-busy');
        resourcesContainer.innerHTML = '';

        if (total === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = `
                <div class="empty-state__icon"><i class="fas fa-magnifying-glass" aria-hidden="true"></i></div>
                <div class="empty-state__title">No matching resources</div>
                <div class="empty-state__desc">Try a different search term or remove a filter to broaden your results.</div>
                <button type="button" class="btn btn-ghost" id="empty-reset">
                    <i class="fas fa-rotate-left" aria-hidden="true"></i><span>Reset filters</span>
                </button>
            `;
            resourcesContainer.appendChild(empty);
            empty.querySelector('#empty-reset').addEventListener('click', resetFilters);
            return;
        }

        // current page slice
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, total);
        const slice = filteredResources.slice(start, end);

        // Build with fragment for performance
        const frag = document.createDocumentFragment();
        slice.forEach((r, i) => {
            frag.appendChild(buildCard(r, term, i));
        });
        resourcesContainer.appendChild(frag);
    }

    function buildCard(r, term, index) {
        const card = document.createElement('article');
        card.className = 'resource-card';
        card.style.animationDelay = `${Math.min(index * 18, 240)}ms`;

        const name = highlightMatches(r.name, term);
        const desc = r.description
            ? highlightMatches(r.description, term)
            : '<em style="color:var(--text-muted)">No description provided.</em>';

        const favicon = faviconURL(r.url);
        const domain = getDomain(r.url);

        const tagsHTML = (r.tags || []).slice(0, 6).map((t) => {
            const safe = escapeHTML(t);
            return `<button type="button" class="resource-tag" data-filter-tag="${safe}" title="Search for ${safe}">${highlightMatches(t, term)}</button>`;
        }).join('');

        card.innerHTML = `
            <header class="resource-card__head">
                <div class="resource-card__favicon" aria-hidden="true">
                    ${favicon ? `<img src="${favicon}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='<i class=&quot;fas fa-globe&quot;></i>'">` : `<i class="fas fa-globe"></i>`}
                </div>
                <h3 class="resource-card__title" title="${escapeHTML(r.name)}">${name}</h3>
            </header>
            <div class="resource-card__body">
                <p class="resource-card__desc">${desc}</p>
                <div class="resource-card__meta">
                    <button type="button" class="meta-pill" data-filter-list="${escapeHTML(r.list)}" title="Filter by ${escapeHTML(r.list)}">
                        <i class="fas fa-list" aria-hidden="true"></i><span>${escapeHTML(r.list)}</span>
                    </button>
                    <button type="button" class="meta-pill" data-filter-category="${escapeHTML(r.category)}" title="Filter by ${escapeHTML(r.category)}">
                        <i class="fas fa-folder" aria-hidden="true"></i><span>${escapeHTML(r.category)}</span>
                    </button>
                </div>
                ${tagsHTML ? `<div class="resource-card__tags">${tagsHTML}</div>` : ''}
            </div>
            <footer class="resource-card__foot">
                <span class="resource-card__url" title="${escapeHTML(r.url)}">${escapeHTML(domain)}</span>
                <a class="resource-card__visit" href="${escapeHTML(r.url)}" target="_blank" rel="noopener" aria-label="Visit ${escapeHTML(r.name)}">
                    <span>Visit</span><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i>
                </a>
            </footer>
        `;
        return card;
    }

    /* -------------------- Metadata -------------------- */
    async function loadLastUpdateTime() {
        const el = $('last-updated');
        try {
            const res = await fetch('data/metadata.json');
            if (!res.ok) throw new Error(res.statusText);
            const meta = await res.json();
            if (meta.last_updated) {
                el.textContent = `Last updated: ${new Date(meta.last_updated).toLocaleString()}`;
            }
        } catch (err) {
            console.error('Error loading metadata:', err);
            el.textContent = 'Last updated: unknown';
        }
    }
});
