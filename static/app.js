/**
 * NYC Subway Tracker - Frontend
 * Handles station search, quick access, arrival display, and filtering
 */

// Use relative URLs since we're served from the same Flask app
const API_BASE_URL = '';
const RECENT_STATIONS_KEY = 'nyc_subway_recent_stations';
const FAVORITE_STATIONS_KEY = 'nyc_subway_favorite_stations';
const ROUTE_LEGEND_SEEN_KEY = 'nyc_route_legend_seen';
const MAX_RECENT_STATIONS = 5;
const MAX_FAVORITE_STATIONS = 8;

// Global state
let allStations = [];             // All available stations for search
let currentArrivalsData = null;   // Current station's arrival data
let selectedRoute = null;         // Currently selected train filter (or null for all)
let selectedDirectionGroup = null; // Top-tier direction family filter (or null for all)
let currentStationId = null;      // Currently displayed station ID
let selectedDirectoryRoute = null; // Selected route from route directory
let recentStationIds = [];        // Recently viewed station IDs (localStorage)
let favoriteStationIds = [];      // Favorited station IDs (localStorage)
let lastDataUpdatedAt = null;     // Last successful data refresh timestamp
let freshnessIntervalId = null;   // Interval id for freshness labels

// Load app state on page load
document.addEventListener('DOMContentLoaded', () => {
    loadQuickAccessState();
    setupSearch();
    setupQuickAccessInteractions();
    setupHeroLampFlicker();
    setupRouteLegendHelper();
    loadStations();
});

function setupRouteLegendHelper() {
    const legend = document.getElementById('route-legend-helper');
    const dismissBtn = document.getElementById('route-legend-dismiss');
    if (!legend || !dismissBtn) return;

    const alreadySeen = localStorage.getItem(ROUTE_LEGEND_SEEN_KEY) === '1';
    legend.style.display = alreadySeen ? 'none' : 'block';

    dismissBtn.addEventListener('click', () => {
        localStorage.setItem(ROUTE_LEGEND_SEEN_KEY, '1');
        legend.style.display = 'none';
    });
}

function markDataUpdatedNow() {
    lastDataUpdatedAt = new Date();
    updateFreshnessLabels();

    if (freshnessIntervalId !== null) return;
    freshnessIntervalId = setInterval(updateFreshnessLabels, 15000);
}

function getFreshnessText() {
    if (!lastDataUpdatedAt) return 'Updated just now';

    const diffSeconds = Math.max(0, Math.floor((Date.now() - lastDataUpdatedAt.getTime()) / 1000));
    if (diffSeconds < 10) return 'Updated just now';
    if (diffSeconds < 60) return `Updated ${diffSeconds}s ago`;

    const diffMins = Math.floor(diffSeconds / 60);
    if (diffMins === 1) return 'Updated 1 min ago';
    return `Updated ${diffMins} mins ago`;
}

function updateFreshnessLabels() {
    const text = getFreshnessText();
    document.querySelectorAll('.data-freshness').forEach(el => {
        el.textContent = text;
    });
}

function setupHeroLampFlicker() {
    const heroEntrance = document.querySelector('.hero-entrance');
    if (!heroEntrance) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function queueNextFlash() {
        const waitMs = 1800 + Math.floor(Math.random() * 3200);
        setTimeout(() => {
            const modeRoll = Math.random();
            const flashMs = 120 + Math.floor(Math.random() * 180);

            if (modeRoll < 0.42) {
                heroEntrance.classList.add('lamp-flash-left');
            } else if (modeRoll < 0.84) {
                heroEntrance.classList.add('lamp-flash-right');
            } else {
                heroEntrance.classList.add('lamp-flash-left', 'lamp-flash-right');
            }

            setTimeout(() => {
                heroEntrance.classList.remove('lamp-flash-left', 'lamp-flash-right');
                queueNextFlash();
            }, flashMs);
        }, waitMs);
    }

    queueNextFlash();
}

function loadQuickAccessState() {
    recentStationIds = getStoredStationList(RECENT_STATIONS_KEY);
    favoriteStationIds = getStoredStationList(FAVORITE_STATIONS_KEY);
}

function getStoredStationList(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter(value => typeof value === 'string');
    } catch (error) {
        return [];
    }
}

function setStoredStationList(key, values) {
    localStorage.setItem(key, JSON.stringify(values));
}

/**
 * Load all available subway stations from the API
 * Called once on page load
 */
async function loadStations() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/stations`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        allStations = await response.json();
        renderQuickAccess();
    } catch (error) {
        showError('Error loading stations. Please refresh the page.');
    }
}

function setupQuickAccessInteractions() {
    const recentContainer = document.getElementById('recent-stations');
    const favoriteContainer = document.getElementById('favorite-stations');

    function handleQuickAccessClick(event) {
        const chip = event.target.closest('.station-chip');
        if (!chip) return;

        const stationId = chip.getAttribute('data-station-id');
        const station = allStations.find(s => s.id === stationId);
        if (!station) return;

        document.getElementById('station-search').value = station.name;
        searchArrivals();
    }

    recentContainer.addEventListener('click', handleQuickAccessClick);
    favoriteContainer.addEventListener('click', handleQuickAccessClick);

    function handleQuickAccessKeydown(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const chip = event.target.closest('.station-chip');
        if (!chip) return;
        event.preventDefault();
        chip.click();
    }

    recentContainer.addEventListener('keydown', handleQuickAccessKeydown);
    favoriteContainer.addEventListener('keydown', handleQuickAccessKeydown);
}

function renderQuickAccess() {
    const recentContainer = document.getElementById('recent-stations');
    const favoriteContainer = document.getElementById('favorite-stations');

    renderStationChips(recentContainer, recentStationIds, 'No recent stations yet.');
    renderStationChips(favoriteContainer, favoriteStationIds, 'Tap the star to save favorites.');
}

function renderStationChips(container, stationIds, emptyMessage) {
    const validStationIds = stationIds.filter(stationId => allStations.some(s => s.id === stationId));

    if (validStationIds.length !== stationIds.length) {
        if (container.id === 'recent-stations') {
            recentStationIds = validStationIds;
            setStoredStationList(RECENT_STATIONS_KEY, recentStationIds);
        } else if (container.id === 'favorite-stations') {
            favoriteStationIds = validStationIds;
            setStoredStationList(FAVORITE_STATIONS_KEY, favoriteStationIds);
        }
    }

    if (validStationIds.length === 0) {
        container.innerHTML = `<span class="chip-empty">${emptyMessage}</span>`;
        return;
    }

    container.innerHTML = validStationIds.map(stationId => {
        const station = allStations.find(s => s.id === stationId);
        const stationName = station ? station.name : stationId;
        const isFavorite = favoriteStationIds.includes(stationId);
        const favoriteClass = isFavorite ? ' favorite' : '';

        return `
            <sl-tag size="small" pill class="station-chip sl-chip-tag${favoriteClass}" data-station-id="${stationId}" title="View ${escapeHtml(stationName)}" role="button" tabindex="0">
                ${escapeHtml(stationName)}
            </sl-tag>
        `;
    }).join('');
}

function addRecentStation(stationId) {
    recentStationIds = [stationId, ...recentStationIds.filter(id => id !== stationId)].slice(0, MAX_RECENT_STATIONS);
    setStoredStationList(RECENT_STATIONS_KEY, recentStationIds);
    renderQuickAccess();
}

function isFavoriteStation(stationId) {
    return favoriteStationIds.includes(stationId);
}

function toggleFavoriteStation(stationId) {
    if (isFavoriteStation(stationId)) {
        favoriteStationIds = favoriteStationIds.filter(id => id !== stationId);
    } else {
        favoriteStationIds = [stationId, ...favoriteStationIds.filter(id => id !== stationId)].slice(0, MAX_FAVORITE_STATIONS);
    }

    setStoredStationList(FAVORITE_STATIONS_KEY, favoriteStationIds);
    renderQuickAccess();
}

function toggleFavoriteStationFromButton(stationId, buttonEl) {
    toggleFavoriteStation(stationId);

    if (!buttonEl) return;

    const isFavorite = isFavoriteStation(stationId);
    buttonEl.classList.toggle('active', isFavorite);
    buttonEl.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
    buttonEl.setAttribute('title', isFavorite ? 'Remove from favorites' : 'Save as favorite');
    buttonEl.textContent = isFavorite ? '★' : '☆';
}

/**
 * Set up search functionality with autocomplete
 * Includes keyboard navigation (arrow keys) and Enter key support
 */
function setupSearch() {
    const searchInput = document.getElementById('station-search');
    const suggestionsDiv = document.getElementById('suggestions');

    // Show autocomplete suggestions as user types
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.trim().toLowerCase();

        if (searchTerm.length < 2) {
            suggestionsDiv.innerHTML = '';
            suggestionsDiv.style.display = 'none';
            return;
        }

        // Filter stations
        const matches = allStations.filter(station =>
            station.name.toLowerCase().includes(searchTerm)
        ).slice(0, 8); // Show max 8 suggestions

        if (matches.length === 0) {
            suggestionsDiv.innerHTML = '<div class="suggestion-item no-match">No stations found</div>';
            suggestionsDiv.style.display = 'block';
            return;
        }

        suggestionsDiv.innerHTML = matches.map(station =>
            `<div class="suggestion-item" data-id="${station.id}" data-name="${escapeHtml(station.name)}">
                ${escapeHtml(station.name)}
            </div>`
        ).join('');
        suggestionsDiv.style.display = 'block';

        // Add click handlers to suggestions
        suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.getAttribute('data-name');
                if (name) {
                    searchInput.value = name;
                    suggestionsDiv.innerHTML = '';
                    suggestionsDiv.style.display = 'none';
                    searchArrivals();
                }
            });
        });
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
        }
    });

    // Allow Enter key in search to trigger arrivals
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            suggestionsDiv.style.display = 'none';
            searchArrivals();
        }
    });

    // Handle keyboard navigation (arrow keys)
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item:not(.no-match)');
        if (items.length === 0) return;

        const active = suggestionsDiv.querySelector('.suggestion-item.active');
        let currentIndex = active ? Array.from(items).indexOf(active) : -1;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            currentIndex = (currentIndex + 1) % items.length;
            updateActiveSuggestion(items, currentIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            currentIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            updateActiveSuggestion(items, currentIndex);
        }
    });
}

function updateActiveSuggestion(items, index) {
    items.forEach(item => item.classList.remove('active'));
    if (items[index]) {
        items[index].classList.add('active');
        const name = items[index].getAttribute('data-name');
        document.getElementById('station-search').value = name;
    }
}

async function searchArrivals() {
    const searchValue = document.getElementById('station-search').value.trim();

    if (!searchValue) {
        showError('Please enter a station name');
        return;
    }

    let stationId = null;

    // Try exact name match first (case insensitive)
    let station = allStations.find(s =>
        s.name.toLowerCase() === searchValue.toLowerCase()
    );

    if (!station) {
        // Try exact ID match
        station = allStations.find(s =>
            s.id.toLowerCase() === searchValue.toLowerCase()
        );
    }

    if (!station) {
        // Try partial name match
        const matches = allStations.filter(s =>
            s.name.toLowerCase().includes(searchValue.toLowerCase())
        );

        if (matches.length === 1) {
            station = matches[0];
        } else if (matches.length > 1) {
            showError(`Multiple stations found. Please be more specific. Try: ${matches.slice(0, 3).map(s => s.name).join(', ')}`);
            return;
        } else {
            showError('Station not found. Please check the name and try again.');
            return;
        }
    }

    stationId = station.id;
    await fetchAndDisplayStationArrivals(stationId, station.name);
}

function displayResults(data) {
    // Store data globally for filtering
    currentArrivalsData = data;
    selectedRoute = null;
    selectedDirectionGroup = null;
    selectedDirectoryRoute = null;
    syncRouteDirectoryActive(null);

    const resultsDiv = document.getElementById('results');
    const stationInfo = document.getElementById('station-info');
    const arrivalsList = document.getElementById('arrivals-list');

    // Find station name from our station list
    const station = allStations.find(s => s.id === data.station_id);

    let stationHeader = '';
    if (station) {
        const isFavorite = isFavoriteStation(station.id);
        const routeCount = data.arrivals ? new Set(data.arrivals.map(a => a.route)).size : 0;

        stationHeader = `
            <div class="station-header">
                <h2>${escapeHtml(station.name)}</h2>
                <div class="station-actions">
                    <sl-button id="favorite-btn" size="small" circle class="sl-action-btn sl-action-btn-ghost sl-icon-btn favorite-btn ${isFavorite ? 'active' : ''}" onclick="toggleFavoriteStationFromButton('${station.id}', this)" aria-label="${isFavorite ? 'Remove from favorites' : 'Save as favorite'}" aria-pressed="${isFavorite ? 'true' : 'false'}" title="${isFavorite ? 'Remove from favorites' : 'Save as favorite'}">
                        ${isFavorite ? '★' : '☆'}
                    </sl-button>
                    <sl-button id="refresh-btn" size="small" circle class="sl-action-btn sl-action-btn-secondary sl-icon-btn refresh-btn" onclick="refreshArrivals()" title="Refresh arrivals" aria-label="Refresh arrivals">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                    </sl-button>
                </div>
            </div>
            <div class="route-count">${routeCount} line${routeCount === 1 ? '' : 's'} active in the next 30 minutes</div>
            <div class="data-freshness">${getFreshnessText()}</div>
            <div id="active-filter-summary" class="active-filter-summary">All lines · All bounds</div>
            <div id="direction-filters"></div>
            <div id="route-filters"></div>
        `;
    }

    stationInfo.innerHTML = stationHeader;
    stationInfo.style.display = 'block';

    if (!data.arrivals || data.arrivals.length === 0) {
        arrivalsList.innerHTML = '<div class="no-arrivals">No upcoming arrivals found. Please verify the station or try again later.</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    const allArrivals = data.all_arrivals || data.arrivals || [];
    updateDirectionFilters(allArrivals, null);
    updateRouteFilters(data.arrivals, null, selectedDirectionGroup);
    updateActiveFilterSummary();

    // Display route-scoped bounds view
    displaySummaryView(allArrivals);

    resultsDiv.style.display = 'block';
}

function getRoutesForDirection(arrivals, directionFilter) {
    const safeArrivals = Array.isArray(arrivals) ? arrivals : [];
    return [...new Set(
        safeArrivals
            .filter(arrival => arrival && arrival.route && matchesDirectionGroup(arrival.direction, directionFilter))
            .map(arrival => arrival.route)
    )].sort();
}

function updateRouteFilters(arrivals, currentFilter, directionFilter = null) {
    const routes = getRoutesForDirection(arrivals, directionFilter);
    const filtersDiv = document.getElementById('route-filters');

    if (!filtersDiv) return;
    if (routes.length === 0) {
        filtersDiv.innerHTML = '';
        return;
    }

    filtersDiv.innerHTML = `
        <div class="filter-label">Filter by line</div>
        <div class="filter-buttons" role="group" aria-label="Filter arrivals by line">
            <sl-button size="small" pill class="filter-btn sl-filter-all ${currentFilter === null ? 'active' : ''}" data-route="all" aria-pressed="${currentFilter === null ? 'true' : 'false'}" onclick="filterByRoute(null, this)">All</sl-button>
            ${routes.map(route =>
                `<sl-button size="small" circle class="filter-btn sl-filter-route filter-route-${route} ${currentFilter === route ? 'active' : ''}" data-route="${route}" aria-pressed="${currentFilter === route ? 'true' : 'false'}" onclick="filterByRoute('${route}', this)">${route}</sl-button>`
            ).join('')}
        </div>
    `;
}

const DIRECTION_GROUPS = [
    { key: 'uptown', label: 'Uptown' },
    { key: 'downtown', label: 'Downtown' },
    { key: 'queens', label: 'Queens-bound' },
    { key: 'brooklyn', label: 'Brooklyn-bound' },
    { key: 'manhattan', label: 'Manhattan-bound' }
];

function normalizeDirectionText(direction) {
    return (direction || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[-_/]/g, ' ')
        .replace(/\s+/g, ' ');
}

function getDirectionGroupsForDirection(direction) {
    const text = normalizeDirectionText(direction);
    const matches = [];

    const isUptown = text.includes('uptown') || text.includes('northbound') || text === 'n' || text.startsWith('n ');
    const isDowntown = text.includes('downtown') || text.includes('southbound') || text === 's' || text.startsWith('s ');
    const isQueens = text.includes('queens') || text.includes('jamaica') || text.includes('flushing') || text.includes('astoria') || text.includes('forest hills') || text.includes('court sq') || text.includes('kew');
    const isBrooklyn = text.includes('brooklyn') || text.includes('coney') || text.includes('flatbush') || text.includes('new lots') || text.includes('bay ridge') || text.includes('canarsie') || text.includes('borough hall') || text.includes('atlantic');
    const isManhattan = text.includes('manhattan') || text.includes('times sq') || text.includes('hudson yards') || text.includes('inwood') || text.includes('harlem') || text.includes('world trade center') || text.includes('south ferry') || text.includes('14 st') || text.includes('34 st') || text.includes('42 st');

    if (isUptown) matches.push('uptown');
    if (isDowntown) matches.push('downtown');
    if (isQueens) matches.push('queens');
    if (isBrooklyn) matches.push('brooklyn');
    if (isManhattan) matches.push('manhattan');

    return matches;
}

function matchesDirectionGroup(direction, groupKey) {
    if (!groupKey) return true;
    return getDirectionGroupsForDirection(direction).includes(groupKey);
}

function getAvailableDirectionGroups(arrivals) {
    const groupedKeys = new Set();

    (Array.isArray(arrivals) ? arrivals : []).forEach(arrival => {
        if (!arrival || !arrival.direction) return;
        getDirectionGroupsForDirection(arrival.direction).forEach(key => groupedKeys.add(key));
    });

    return DIRECTION_GROUPS.filter(group => groupedKeys.has(group.key));
}

function updateDirectionFilters(arrivals, currentDirection) {
    const filtersDiv = document.getElementById('direction-filters');
    if (!filtersDiv) return;

    const groups = getAvailableDirectionGroups(arrivals);
    if (groups.length === 0) {
        filtersDiv.innerHTML = '';
        return;
    }

    filtersDiv.innerHTML = `
        <div class="filter-label">Filter by direction</div>
        <div class="direction-filter-buttons" role="group" aria-label="Filter arrivals by direction">
            <sl-button size="small" pill class="dir-filter-btn ${currentDirection === null ? 'active' : ''}" data-direction="all" aria-pressed="${currentDirection === null ? 'true' : 'false'}" onclick="filterByDirectionGroup(null, this)">All bounds</sl-button>
            ${groups.map(group =>
                `<sl-button size="small" pill class="dir-filter-btn ${currentDirection === group.key ? 'active' : ''}" data-direction="${group.key}" aria-pressed="${currentDirection === group.key ? 'true' : 'false'}" onclick="filterByDirectionGroup('${group.key}', this)">${group.label}</sl-button>`
            ).join('')}
            ${(selectedRoute !== null || selectedDirectionGroup !== null)
                ? '<sl-button size="small" pill class="dir-filter-btn clear-filter-btn" onclick="resetActiveFilters()">Clear filters</sl-button>'
                : ''
            }
        </div>
    `;
}

function getDirectionGroupLabel(key) {
    if (!key) return 'All bounds';
    return DIRECTION_GROUPS.find(group => group.key === key)?.label || 'Selected bound';
}

function updateActiveFilterSummary() {
    const summaryEl = document.getElementById('active-filter-summary');
    if (!summaryEl) return;

    const lineLabel = selectedRoute ? `Line ${selectedRoute}` : 'All lines';
    const boundLabel = getDirectionGroupLabel(selectedDirectionGroup);
    summaryEl.textContent = `${lineLabel} · ${boundLabel}`;
}

function displaySummaryView(arrivals) {
    renderRouteBoundSections(arrivals, selectedRoute, selectedDirectionGroup);
}

function displayFilteredView(route) {
    renderRouteBoundSections(currentArrivalsData.all_arrivals || [], route, selectedDirectionGroup);
}

function filterByRoute(route, buttonEl) {
    selectedRoute = route;

    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });

    if (buttonEl) {
        buttonEl.classList.add('active');
        buttonEl.setAttribute('aria-pressed', 'true');
    }

    if (route === null) {
        // Show summary view
        displaySummaryView(currentArrivalsData.all_arrivals || currentArrivalsData.arrivals || []);
    } else {
        // Show filtered view for specific route
        displayFilteredView(route);
    }
    updateDirectionFilters(currentArrivalsData.all_arrivals || currentArrivalsData.arrivals || [], selectedDirectionGroup);
    updateActiveFilterSummary();

}

function filterByDirectionGroup(directionGroup, buttonEl) {
    selectedDirectionGroup = directionGroup;

    document.querySelectorAll('.dir-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
    });

    if (buttonEl) {
        buttonEl.classList.add('active');
        buttonEl.setAttribute('aria-pressed', 'true');
    }

    const validRoutes = getRoutesForDirection(currentArrivalsData?.arrivals || [], selectedDirectionGroup);
    if (selectedRoute !== null && !validRoutes.includes(selectedRoute)) {
        selectedRoute = null;
    }

    updateRouteFilters(currentArrivalsData?.arrivals || [], selectedRoute, selectedDirectionGroup);

    if (selectedRoute === null) {
        displaySummaryView(currentArrivalsData.all_arrivals || currentArrivalsData.arrivals || []);
    } else {
        displayFilteredView(selectedRoute);
    }
    updateDirectionFilters(currentArrivalsData.all_arrivals || currentArrivalsData.arrivals || [], selectedDirectionGroup);
    updateActiveFilterSummary();
}

function resetActiveFilters() {
    selectedRoute = null;
    selectedDirectionGroup = null;
    syncRouteFilterActive(null);

    const arrivals = currentArrivalsData?.all_arrivals || currentArrivalsData?.arrivals || [];
    updateDirectionFilters(arrivals, null);
    updateRouteFilters(currentArrivalsData?.arrivals || arrivals, null, null);
    displaySummaryView(arrivals);
    updateActiveFilterSummary();
}

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

async function refreshArrivals() {
    if (!currentStationId) return;

    // Add spinning animation
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.classList.add('spinning');
        refreshBtn.disabled = true;
        refreshBtn.setAttribute('aria-busy', 'true');
    }

    // Hide error messages
    document.getElementById('error-message').style.display = 'none';

    try {
        const response = await fetch(`${API_BASE_URL}/api/arrivals?station_id=${encodeURIComponent(currentStationId)}`);

        if (!response.ok) {
            const data = await response.json();
            showError(data.error || 'Error fetching arrivals');
            return;
        }

        const data = await response.json();
        markDataUpdatedNow();

        // Update the display with new data
        currentArrivalsData = data;

        // Re-render based on current filter state
        if (selectedRoute === null) {
            displaySummaryView(data.all_arrivals || data.arrivals || []);
        } else {
            displayFilteredView(selectedRoute);
        }

        // Update the filters in case routes changed
        updateDirectionFilters(data.all_arrivals || data.arrivals || [], selectedDirectionGroup);
        const validRoutes = getRoutesForDirection(data.arrivals || [], selectedDirectionGroup);
        if (selectedRoute !== null && !validRoutes.includes(selectedRoute)) {
            selectedRoute = null;
        }
        updateRouteFilters(data.arrivals, selectedRoute, selectedDirectionGroup);
        updateActiveFilterSummary();
    } catch (error) {
        showError(`Error: ${error.message}`);
    } finally {
        // Remove spinning animation
        if (refreshBtn) {
            refreshBtn.classList.remove('spinning');
            refreshBtn.disabled = false;
            refreshBtn.setAttribute('aria-busy', 'false');
        }
    }
}

function setButtonBusy(buttonEl, isBusy) {
    if (!buttonEl) return;

    buttonEl.disabled = isBusy;
    buttonEl.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

async function onRouteDirectorySelect(route, buttonEl) {
    selectedDirectoryRoute = route;
    syncRouteDirectoryActive(route);
    selectedRoute = null;
    selectedDirectionGroup = null;
    syncRouteFilterActive(null);

    const errorDiv = document.getElementById('error-message');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }

    document.getElementById('loading').style.display = 'block';

    try {
        const response = await fetch(`${API_BASE_URL}/api/route-board?route=${encodeURIComponent(route)}`);

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || `Failed to load route ${route}`);
        }

        const data = await response.json();
        markDataUpdatedNow();
        renderRouteBoard(data);
    } catch (error) {
        showError(`Could not load route board: ${error.message}`);
        renderRouteBoardError(route);
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

function renderRouteBoard(data) {
    const resultsDiv = document.getElementById('results');
    const stationInfo = document.getElementById('station-info');
    const arrivalsList = document.getElementById('arrivals-list');
    const route = escapeHtml(data.route || selectedDirectoryRoute || '');
    const stations = Array.isArray(data.stations) ? data.stations : [];

    currentArrivalsData = null;
    currentStationId = null;

    stationInfo.innerHTML = `
        <div class="station-header">
            <h2 class="route-board-title">
                <span class="route-badge route-${route}">${route}</span>
                Route ${route} Board
            </h2>
        </div>
        <div class="route-count">${stations.length} station${stations.length === 1 ? '' : 's'} reporting next arrivals</div>
        <div class="data-freshness">${getFreshnessText()}</div>
    `;

    if (stations.length === 0) {
        arrivalsList.innerHTML = '<div class="no-arrivals">No route-board arrivals found right now.</div>';
        resultsDiv.style.display = 'block';
        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }

    const directionCounts = new Map();
    stations.forEach(station => {
        const bounds = Array.isArray(station.bounds) ? station.bounds : [];
        bounds.forEach(bound => {
            const direction = bound.direction || 'Direction';
            directionCounts.set(direction, (directionCounts.get(direction) || 0) + 1);
        });
    });

    const primaryDirections = Array.from(directionCounts.entries())
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([direction]) => direction);

    while (primaryDirections.length < 2) {
        primaryDirections.push('Direction');
    }

    const hiddenDirectionCount = Math.max(0, directionCounts.size - 2);

    arrivalsList.innerHTML = `
        <div class="route-board-table-wrap">
            <div class="route-board-table">
                <div class="route-board-cell route-board-head route-board-station-col">Station</div>
                <div class="route-board-cell route-board-head">${escapeHtml(primaryDirections[0])}</div>
                <div class="route-board-cell route-board-head">${escapeHtml(primaryDirections[1])}</div>

            ${stations.map((station, rowIndex) => {
                const stationName = escapeHtml(station.station_name || station.station_id || 'Unknown station');
                const stationId = station.station_id || '';
                const bounds = Array.isArray(station.bounds) ? station.bounds : [];
                const boundByDirection = {};
                bounds.forEach(bound => {
                    if (bound && bound.direction) {
                        boundByDirection[bound.direction] = bound;
                    }
                });
                const boundOne = boundByDirection[primaryDirections[0]];
                const boundTwo = boundByDirection[primaryDirections[1]];
                const rowAltClass = rowIndex % 2 === 1 ? 'row-alt' : '';

                return `
                    <div class="route-board-cell route-board-station-cell ${rowAltClass}">
                        <button type="button" class="route-board-station-link" data-station-id="${escapeHtml(stationId)}" onclick="openStationFromRouteBoard(this.dataset.stationId)">
                            ${stationName}
                        </button>
                    </div>
                    <div class="route-board-cell ${rowAltClass}">${renderRouteBoardEtaCell(boundOne)}</div>
                    <div class="route-board-cell ${rowAltClass}">${renderRouteBoardEtaCell(boundTwo)}</div>
                `;
            }).join('')}
            </div>
            ${hiddenDirectionCount > 0 ? `<p class="route-board-note">Showing 2 main bounds. ${hiddenDirectionCount} additional bound${hiddenDirectionCount === 1 ? '' : 's'} hidden.</p>` : ''}
        </div>
    `;

    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderRouteBoardEtaCell(bound) {
    if (!bound) {
        return '<div class="route-board-empty">—</div>';
    }

    const minutes = Number.isFinite(bound.minutes_until_arrival)
        ? (bound.minutes_until_arrival <= 0 ? 'Arriving' : `${bound.minutes_until_arrival} min`)
        : '--';
    const time = escapeHtml(bound.arrival_time || '--:--');

    return `
        <div class="route-board-eta-card">
            <div class="route-board-minutes">${minutes}</div>
            <div class="route-board-time">${time}</div>
        </div>
    `;
}

function renderRouteBoardError(route) {
    const resultsDiv = document.getElementById('results');
    const stationInfo = document.getElementById('station-info');
    const arrivalsList = document.getElementById('arrivals-list');

    stationInfo.innerHTML = `
        <div class="station-header">
            <h2 class="route-board-title">
                <span class="route-badge route-${escapeHtml(route)}">${escapeHtml(route)}</span>
                Route ${escapeHtml(route)} Board
            </h2>
        </div>
    `;

    arrivalsList.innerHTML = `
        <div class="no-arrivals">Route board is temporarily unavailable. Please try again.</div>
    `;

    resultsDiv.style.display = 'block';
}

async function openStationFromRouteBoard(stationId) {
    if (!stationId) return;

    const station = allStations.find(s => s.id === stationId);
    const displayName = station ? station.name : stationId;
    await fetchAndDisplayStationArrivals(stationId, displayName);
}

async function fetchAndDisplayStationArrivals(stationId, stationName) {
    const searchButton = document.getElementById('search-btn');

    currentStationId = stationId;
    if (stationName) {
        document.getElementById('station-search').value = stationName;
    }

    document.getElementById('results').style.display = 'none';
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    setButtonBusy(searchButton, true);

    try {
        const response = await fetch(`${API_BASE_URL}/api/arrivals?station_id=${encodeURIComponent(stationId)}`);

        if (!response.ok) {
            const data = await response.json();
            document.getElementById('loading').style.display = 'none';
            showError(data.error || 'Error fetching arrivals');
            return;
        }

        const data = await response.json();
        markDataUpdatedNow();

        document.getElementById('loading').style.display = 'none';
        addRecentStation(stationId);
        displayResults(data);
    } catch (error) {
        document.getElementById('loading').style.display = 'none';
        showError(`Error: ${error.message}. Make sure the backend server is running.`);
    } finally {
        setButtonBusy(searchButton, false);
    }
}

function syncRouteDirectoryActive(route) {
    document.querySelectorAll('.route-directory-btn').forEach(btn => {
        const isActive = route !== null && btn.textContent.trim() === route;
        btn.classList.toggle('active', isActive);
    });
}

function syncRouteFilterActive(route) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const btnRoute = btn.getAttribute('data-route');
        const shouldBeActive = route === null ? btnRoute === 'all' : btnRoute === route;
        btn.classList.toggle('active', shouldBeActive);
        btn.setAttribute('aria-pressed', shouldBeActive ? 'true' : 'false');
    });
}

function renderRouteBoundSections(arrivals, routeFilter = null, directionGroupFilter = null) {
    const arrivalsList = document.getElementById('arrivals-list');
    const safeArrivals = Array.isArray(arrivals) ? arrivals : [];

    const grouped = {};
    safeArrivals.forEach(arrival => {
        if (!arrival || !arrival.route || !arrival.direction) return;
        if (routeFilter && arrival.route !== routeFilter) return;
        if (!matchesDirectionGroup(arrival.direction, directionGroupFilter)) return;

        if (!grouped[arrival.route]) grouped[arrival.route] = {};
        if (!grouped[arrival.route][arrival.direction]) grouped[arrival.route][arrival.direction] = [];
        grouped[arrival.route][arrival.direction].push(arrival);
    });

    const routes = Object.keys(grouped).sort();
    if (routes.length === 0) {
        arrivalsList.innerHTML = `<div class="no-arrivals">${getNoArrivalsMessage(routeFilter, directionGroupFilter)}</div>`;
        return;
    }

    arrivalsList.innerHTML = routes.map(route => {
        const directions = Object.keys(grouped[route]);
        directions.forEach(direction => {
            grouped[route][direction].sort((a, b) => a.minutes_until_arrival - b.minutes_until_arrival);
        });

        const primaryDirections = directions
            .slice()
            .sort((a, b) => (grouped[route][a][0]?.minutes_until_arrival ?? 999) - (grouped[route][b][0]?.minutes_until_arrival ?? 999))
            .slice(0, 2);

        while (primaryDirections.length < 2) {
            primaryDirections.push('Direction');
        }

        const dirA = primaryDirections[0];
        const dirB = primaryDirections[1];
        const arrA = (grouped[route][dirA] || []).slice(0, 4);
        const arrB = (grouped[route][dirB] || []).slice(0, 4);
        const maxRows = Math.max(arrA.length, arrB.length, 1);
        const extraA = Math.max(0, (grouped[route][dirA] || []).length - arrA.length);
        const extraB = Math.max(0, (grouped[route][dirB] || []).length - arrB.length);

        return `
            <section class="station-route-table-section">
                <div class="station-route-table-head">
                    <span class="route-badge route-${route}">${route}</span>
                    <h3>${route} Train</h3>
                </div>
                <div class="station-route-grid">
                    <div class="station-route-grid-head">${escapeHtml(dirA)}</div>
                    <div class="station-route-grid-head">${escapeHtml(dirB)}</div>
                    ${Array.from({ length: maxRows }).map((_, idx) => `
                        <div class="station-route-grid-cell ${idx % 2 === 1 ? 'row-alt' : ''}">${renderRouteBoardEtaCell(arrA[idx])}</div>
                        <div class="station-route-grid-cell ${idx % 2 === 1 ? 'row-alt' : ''}">${renderRouteBoardEtaCell(arrB[idx])}</div>
                    `).join('')}
                </div>
                <div class="station-route-grid-foot">
                    <span>${extraA > 0 ? `+${extraA} more` : ''}</span>
                    <span>${extraB > 0 ? `+${extraB} more` : ''}</span>
                </div>
            </section>
        `;
    }).join('');
}

function getNoArrivalsMessage(routeFilter, directionGroupFilter) {
    const bound = getDirectionGroupLabel(directionGroupFilter);
    if (routeFilter && directionGroupFilter) {
        return `No ${bound} arrivals for line ${routeFilter} in the next 30 minutes.`;
    }
    if (routeFilter) {
        return `No arrivals for line ${routeFilter} in the next 30 minutes.`;
    }
    if (directionGroupFilter) {
        return `No ${bound} arrivals in the next 30 minutes.`;
    }
    return 'No arrivals found in the next 30 minutes.';
}

function escapeHtml(text) {
    if (typeof text !== 'string') return '';

    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, char => map[char]);
}
