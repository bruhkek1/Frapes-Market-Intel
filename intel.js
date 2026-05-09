const API = 'https://api2.warera.io/trpc';

let countryCache = {};  // countryId -> country name
let regionCache = {};   // regionId -> region name
let allCountriesList = []; // Sorted list of all countries for dropdown
let currentRanking = 'countryWealth';
let intelCountryIds = null; // null = auto (top 20), array = user selected

// --- API Calls ---

async function callAPI(endpoint, body = {}) {
  try {
    const res = await fetch(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result.data;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    return null;
  }
}

// --- Country & Region Name Resolution ---

async function fetchAllCountries() {
  const countries = await callAPI('country.getAllCountries');
  if (countries) {
    for (const c of countries) {
      countryCache[c._id] = c.name;
    }
    // Sort alphabetically for dropdown
    allCountriesList = countries.sort((a, b) => a.name.localeCompare(b.name));
    populateCountryDropdown();
  }
}

function populateCountryDropdown() {
  const list = document.getElementById('selectorList');
  if (!list) return;

  // Render all countries
  renderCountryList(allCountriesList);
}

function renderCountryList(countries, filter = '') {
  const list = document.getElementById('selectorList');
  if (!list) return;

  // Filter countries by search
  const filtered = filter
    ? countries.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
    : countries;

  list.innerHTML = filtered.map(c => {
    const isSelected = intelCountryIds && intelCountryIds.includes(c._id);
    const name = filter
      ? highlightMatch(c.name, filter)
      : c.name;
    return `
      <div class="selector-item ${isSelected ? 'selected' : ''}" data-id="${c._id}" onclick="toggleCountry('${c._id}')">
        <span class="check-mark">${isSelected ? '☑' : '☐'}</span>
        <span class="country-name">${name}</span>
      </div>
    `;
  }).join('');

  // Show/hide dropdown message
  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.75rem;font-family:var(--mono);">No countries found</div>';
  }
}

function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

function toggleCountry(id) {
  if (!intelCountryIds) intelCountryIds = [];

  const idx = intelCountryIds.indexOf(id);
  if (idx > -1) {
    intelCountryIds.splice(idx, 1);
    if (intelCountryIds.length === 0) intelCountryIds = null;
  } else {
    intelCountryIds.push(id);
  }

  updateSelectorUI();
  fetchCountryIntel();
}

function selectPreset(preset) {
  intelCountryIds = null;

  if (preset === 'top20') {
    fetchCountryIntel();
  } else if (preset === 'top10') {
    fetchRankingsForPreset('countryProductionBonus');
  } else if (preset === 'all') {
    intelCountryIds = Object.keys(countryCache);
    updateSelectorUI();
    fetchCountryIntel();
  }
}

function fetchRankingsForPreset(type) {
  callAPI('ranking.getRanking', { rankingType: type }).then(data => {
    if (data && data.items) {
      intelCountryIds = data.items.slice(0, 10).map(item => item.country);
      updateSelectorUI();
      fetchCountryIntel();
    }
  });
}

function clearSelection() {
  intelCountryIds = null;
  updateSelectorUI();
  fetchCountryIntel();
}

function updateSelectorUI() {
  const countEl = document.getElementById('selectorCount');
  const count = intelCountryIds ? intelCountryIds.length : 0;
  countEl.textContent = count === 0 ? '0 selected' : `${count} selected`;

  // Re-render list to update checkmarks
  const filter = document.getElementById('countrySearchInput')?.value || '';
  renderCountryList(allCountriesList, filter);
}

async function fetchAllRegions() {
  const regions = await callAPI('region.getRegionsObject');
  if (regions) {
    for (const [id, r] of Object.entries(regions)) {
      regionCache[id] = r.name;
    }
  }
}

function resolveCountry(id) {
  return countryCache[id] || `#${id?.substring(0, 8) || 'unknown'}`;
}

function resolveRegion(id) {
  return regionCache[id] || `#${id?.substring(0, 8) || 'unknown'}`;
}

// --- Events Feed ---

async function fetchEvents() {
  const events = await callAPI('event.getEventsPaginated', { limit: 30 });
  if (!events) return;

  const items = events.items || [];
  document.getElementById('eventCount').textContent = `${items.length} events`;
  renderEvents(items);
}

function renderEvents(events) {
  const container = document.getElementById('eventsList');

  if (!events.length) {
    container.innerHTML = '<p class="placeholder">No events found</p>';
    return;
  }

  // Sort newest first
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  container.innerHTML = events.map(e => {
    const type = e.data?.type || e.data?.event_type || 'unknown';
    const time = timeAgo(e.createdAt);
    const countries = (e.countries || []);
    const countryStr = countries.length > 0
      ? countries.map(id => `<strong>${resolveCountry(id)}</strong>`).join(' + ')
      : '';

    // Build extra context based on event type
    let extra = '';
    switch(type) {
      case 'depositDiscovered':
        extra = ` — ${e.data.itemCode} deposit in ${resolveRegion(e.data.region)}`;
        break;
      case 'depositDepleted':
        extra = ` — ${e.data.itemCode} supply disrupted`;
        break;
      case 'battleEnded':
        const winner = e.data.wonBy === 'attacker' ? resolveCountry(e.data.attackerCountry)
                       : e.data.wonBy === 'defender' ? resolveCountry(e.data.defenderCountry) : 'unknown';
        extra = ` — ${winner} wins`;
        break;
      case 'battleOpened':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' vs ')}`;
        break;
      case 'warDeclared':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' vs ')}`;
        break;
      case 'peaceMade':
      case 'peace_agreement':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'revolutionStarted':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'systemRevolt':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'bankruptcy':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'allianceFormed':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'allianceBroken':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
      case 'newPresident':
        extra = ` — ${countries.map(id => resolveCountry(id)).join(' + ')}`;
        break;
    }

    return `
      <div class="event-item type-${type}">
        <span class="event-type-badge">${type.replace(/([A-Z])/g, ' $1').trim()}</span>
        <span class="event-content">${countryStr}${extra}</span>
        <span class="event-time">${time}</span>
      </div>
    `;
  }).join('');
}

// --- Country Rankings ---

async function fetchRankings() {
  const data = await callAPI('ranking.getRanking', { rankingType: currentRanking });
  if (!data || !data.items) return;

  const items = data.items.slice(0, 10);
  renderRankings(items);
}

function renderRankings(items) {
  const container = document.getElementById('rankingsList');

  if (!items.length) {
    container.innerHTML = '<p class="placeholder">No ranking data</p>';
    return;
  }

  container.innerHTML = items.map((item, idx) => {
    const rank = item.rank || (idx + 1);
    const name = resolveCountry(item.country);
    const value = item.value?.toFixed(0) || '0';
    const tier = item.tier || '';

    return `
      <div class="rank-row">
        <span class="rank-num ${rank <= 3 ? 'top3' : ''}">${rank}</span>
        <span class="rank-name" title="${name}">${name}</span>
        <span class="rank-value">${formatNumber(value)}</span>
        <span class="rank-tier ${tier}">${tier}</span>
      </div>
    `;
  }).join('');
}

function switchRanking(type) {
  currentRanking = type;

  // Update active tab
  document.querySelectorAll('.ranking-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.type === type);
  });

  fetchRankings();
}

// --- Active Battles ---

async function fetchBattles() {
  const data = await callAPI('battle.getBattles', { isActive: true, limit: 10 });
  if (!data) return;

  const items = data.items || [];
  document.getElementById('battleCount').textContent = `${items.length} active`;
  renderBattles(items);
}

function renderBattles(battles) {
  const container = document.getElementById('battlesList');

  if (!battles.length) {
    container.innerHTML = '<p class="placeholder">No active battles</p>';
    return;
  }

  container.innerHTML = battles.map(b => {
    const attacker = b.attacker?.country || '';
    const defender = b.defender?.country || '';
    const attackerName = resolveCountry(attacker);
    const defenderName = resolveCountry(defender);
    const attackerDmg = b.attacker?.damages || 0;
    const defenderDmg = b.defender?.damages || 0;
    const roundsToWin = b.roundsToWin || '?';
    const roundsHistory = b.roundsHistory || [];
    const attackerRounds = roundsHistory.filter(r => r.wonBy === 'attacker')?.length || 0;
    const defenderRounds = roundsHistory.filter(r => r.wonBy === 'defender')?.length || 0;

    return `
      <div class="battle-item">
        <div class="battle-header">
          <span class="battle-war-tag">WAR</span>
          <span class="battle-round-info">Rounds to win: ${roundsToWin}</span>
        </div>
        <div class="battle-teams">
          <div class="battle-team">
            <div class="battle-team-label attacker">ATTACKER</div>
            <div class="battle-team-name">${attackerName}</div>
          </div>
          <div class="battle-vs">VS</div>
          <div class="battle-team">
            <div class="battle-team-label defender">DEFENDER</div>
            <div class="battle-team-name">${defenderName}</div>
          </div>
        </div>
        <div class="battle-stats">
          <div class="battle-stat">
            <span class="battle-stat-val attacker-dmg">${attackerDmg}</span>
            <span>dmg</span>
          </div>
          <div class="battle-stat">
            <span class="battle-stat-val defender-dmg">${defenderDmg}</span>
            <span>dmg</span>
          </div>
          <div class="battle-stat">
            <span>${attackerRounds} - ${defenderRounds}</span>
            <span>rounds</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Country Intelligence ---

async function fetchCountryIntel() {
  let countryIds;

  if (intelCountryIds) {
    // User selected specific countries
    countryIds = intelCountryIds;
  } else {
    // Auto mode: get top 20 by wealth
    const data = await callAPI('ranking.getRanking', { rankingType: 'countryWealth' });
    if (!data || !data.items) return;
    countryIds = data.items.slice(0, 20).map(item => item.country);
  }

  // Fetch full country details in parallel
  const countryPromises = countryIds.map(id =>
    callAPI('country.getCountryById', { countryId: id })
  );

  const countries = await Promise.allSettled(countryPromises);
  const validCountries = countries
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  renderCountryIntel(validCountries);
  document.getElementById('intelCount').textContent = `${validCountries.length} countries`;
}

function renderCountryIntel(countries) {
  const container = document.getElementById('intelGrid');

  if (!countries.length) {
    container.innerHTML = '<p class="placeholder">No country data</p>';
    return;
  }

  container.innerHTML = countries.map(c => {
    // Use rankings data for wealth (more accurate than money field)
    const wealthRanking = c.rankings?.countryWealth;
    const wealth = wealthRanking ? formatNumber(wealthRanking.value) : formatNumber(c.money || 0);
    const rank = wealthRanking?.rank || '?';

    const development = c.development?.toFixed(1) || '0';
    const allies = (c.allies || []).length;
    const wars = (c.warsWith || []).length;
    const unrest = c.unrest?.bar || 0;
    const unrestMax = c.unrest?.barMax || 1;
    const unrestPct = ((unrest / unrestMax) * 100).toFixed(0);

    // Strategic resources
    const resources = c.strategicResources?.resources || {};
    const resourceItems = Object.keys(resources);

    // Tax info
    const taxes = c.taxes || {};

    return `
      <div class="intel-card">
        <div class="intel-card-header">
          <span class="intel-card-name">${c.name}</span>
          <span class="intel-card-rank">#${rank}</span>
          <span class="intel-card-scan-btn" onclick="quickScanCountry('${c._id}')" title="Quick Scan this country">⚡ Quick</span>
          <span class="intel-card-scan-btn deep" onclick="deepScanCountry('${c._id}')" title="Deep Scan this country">🔍 Deep</span>
        </div>
        <div class="intel-card-stats">
          <div class="intel-stat">
            <span class="intel-stat-label">Wealth</span>
            <span class="intel-stat-value wealth">${wealth}</span>
          </div>
          <div class="intel-stat">
            <span class="intel-stat-label">Development</span>
            <span class="intel-stat-value">${development}</span>
          </div>
          <div class="intel-stat">
            <span class="intel-stat-label">Allies</span>
            <span class="intel-stat-value allies">${allies}</span>
          </div>
          <div class="intel-stat">
            <span class="intel-stat-label">Wars</span>
            <span class="intel-stat-value wars">${wars}</span>
          </div>
          <div class="intel-stat">
            <span class="intel-stat-label">Income Tax</span>
            <span class="intel-stat-value">${taxes.income || '?'}</span>
          </div>
          <div class="intel-stat">
            <span class="intel-stat-label">Unrest</span>
            <span class="intel-stat-value ${unrestPct > 70 ? 'unrest-high' : 'unrest-low'}">${unrestPct}%</span>
          </div>
        </div>
        ${resourceItems.length > 0 ? `
          <div class="intel-card-resources">
            <div class="intel-resource-label">Strategic Resources</div>
            <div class="intel-resource-items">
              ${resourceItems.map(r => `<span class="intel-resource-tag">${r}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// --- Utilities ---

function formatNumber(num) {
  const n = parseFloat(num);
  if (isNaN(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'now';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStatus(state, msg) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('status');
  dot.className = 'status-dot ' + state;
  text.textContent = state === 'live' ? 'Live' : (msg || state);
}

// --- Population Scanning ---

const SCAN_CONFIG = {
  quickSampleSize: 10,  // Users to sample for quick scan
  deepSampleSize: 10,   // Users to sample for deep scan (testing limit)
  apiDelay: 500,        // ms delay between API calls for deep scan
  topUsersLimit: 100,   // Get top 100 users by damage for quick scan
  minLevel: 15          // Minimum user level to include in scan
};

let isScanning = false;
let scanResults = {};

// --- Single-Country Quick Scan from Intel Card ---

async function quickScanCountry(countryId) {
  const name = resolveCountry(countryId);
  const statusEl = document.getElementById('scanStatus');
  const resultsEl = document.getElementById('scanResults');

  // Scroll to scan panel
  const scanPanel = document.querySelector('.scan-panel');
  if (scanPanel) scanPanel.scrollIntoView({ behavior: 'smooth' });

  // Show scanning state
  isScanning = true;
  const btn = document.querySelector('.scan-btn');
  if (btn) btn.disabled = true;
  statusEl.textContent = `Scanning ${name}...`;
  const progressEl = document.getElementById('scanProgress');
  if (progressEl) progressEl.style.display = 'block';
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = '50%';

  try {
    const result = await scanCountryQuick(countryId);
    if (result) {
      scanResults = { [countryId]: result };
      renderScanResults();
      statusEl.textContent = `Done: ${name}`;
    } else {
      statusEl.textContent = `No data for ${name}`;
    }
  } catch (err) {
    console.error('Quick scan failed:', err);
    statusEl.textContent = 'Scan failed';
  } finally {
    isScanning = false;
    if (btn) btn.disabled = false;
    if (progressEl) progressEl.style.display = 'none';
    if (bar) bar.style.width = '0%';
  }
}

async function deepScanCountry(countryId) {
  const name = resolveCountry(countryId);
  const statusEl = document.getElementById('scanStatus');
  const resultsEl = document.getElementById('scanResults');

  // Scroll to scan panel
  const scanPanel = document.querySelector('.scan-panel');
  if (scanPanel) scanPanel.scrollIntoView({ behavior: 'smooth' });

  // Show scanning state
  isScanning = true;
  const btn = document.querySelector('.scan-btn');
  if (btn) btn.disabled = true;
  statusEl.textContent = `Deep scanning ${name}...`;
  const progressEl = document.getElementById('scanProgress');
  if (progressEl) progressEl.style.display = 'block';
  const bar = document.getElementById('progressBar');
  if (bar) bar.style.width = '30%';

  try {
    const result = await scanCountryDeep(countryId);
    if (result) {
      scanResults = { [countryId]: result };
      renderScanResults();
      statusEl.textContent = `Done: ${name}`;
    } else {
      statusEl.textContent = `No data for ${name}`;
    }
  } catch (err) {
    console.error('Deep scan failed:', err);
    statusEl.textContent = 'Scan failed';
  } finally {
    isScanning = false;
    if (btn) btn.disabled = false;
    if (progressEl) progressEl.style.display = 'none';
    if (bar) bar.style.width = '0%';
  }
}

async function startQuickScan() {
  if (isScanning || !intelCountryIds) {
    alert('Please select countries first');
    return;
  }

  isScanning = true;
  updateScanUI('scanning');
  scanResults = {};

  const countryIds = Array.from(intelCountryIds);
  const total = countryIds.length;

  for (let i = 0; i < countryIds.length; i++) {
    const countryId = countryIds[i];
    const progress = ((i + 1) / total) * 100;
    updateScanProgress(progress);
    updateScanStatus(`Scanning ${resolveCountry(countryId)} (${i + 1}/${total})`);

    const result = await scanCountryQuick(countryId);
    if (result) {
      scanResults[countryId] = result;
    }

    await sleep(SCAN_CONFIG.apiDelay);
  }

  renderScanResults();
  isScanning = false;
  updateScanUI('ready');
}

async function startDeepScan() {
  if (isScanning || !intelCountryIds) {
    alert('Please select countries first');
    return;
  }

  isScanning = true;
  updateScanUI('scanning');
  scanResults = {};

  const countryIds = Array.from(intelCountryIds);
  const total = countryIds.length;

  for (let i = 0; i < countryIds.length; i++) {
    const countryId = countryIds[i];
    const progress = ((i + 1) / total) * 100;
    updateScanProgress(progress);
    updateScanStatus(`Deep scanning ${resolveCountry(countryId)} (${i + 1}/${total})`);

    const result = await scanCountryDeep(countryId);
    if (result) {
      scanResults[countryId] = result;
    }

    // Rate limiting for deep scan
    await sleep(SCAN_CONFIG.apiDelay);
  }

  renderScanResults();
  isScanning = false;
  updateScanUI('ready');
}

async function scanCountryQuick(countryId) {
  try {
    // Get top users by damage for this country
    const rankingData = await callAPI('ranking.getRanking', { rankingType: 'userDamages' });
    if (!rankingData || !rankingData.items) return null;

    // Get users from this country
    const countryUsers = rankingData.items.filter(u => u.country === countryId);
    if (countryUsers.length === 0) return null;

    // Get user IDs (top N by damage)
    const topUserIds = countryUsers.slice(0, SCAN_CONFIG.topUsersLimit).map(u => u.userId || u.user);
    if (topUserIds.length === 0) return null;

    // Sample users
    const sampledIds = topUserIds.slice(0, SCAN_CONFIG.quickSampleSize);

    // Fetch user data
    const users = await Promise.all(sampledIds.map(id =>
      callAPI('user.getUserLite', { userId: id }).catch(() => null)
    ));

    const validUsers = users.filter(u =>
      u && u.skills && u.leveling && u.leveling.level >= SCAN_CONFIG.minLevel
    );

    return calculatePopulationStats(countryId, validUsers);
  } catch (err) {
    console.error('Quick scan failed:', err);
    return null;
  }
}

async function scanCountryDeep(countryId) {
  try {
    // Paginate through all users
    let allUserIds = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
      const params = { countryId, limit: 100 };
      if (cursor) {
        params.cursor = cursor;
      }

      const data = await callAPI('user.getUsersByCountry', params);

      if (!data || !data.items) break;

      allUserIds = allUserIds.concat(data.items.map(u => u._id));
      cursor = data.nextCursor;
      hasMore = !!cursor;

      // Stop if we have enough
      if (allUserIds.length >= 500) break;
    }

    if (allUserIds.length === 0) return null;

    // Sample users (testing limit)
    const sampledIds = allUserIds.slice(0, SCAN_CONFIG.deepSampleSize);

    // Fetch user data with rate limiting
    const users = [];
    for (const userId of sampledIds) {
      const userData = await callAPI('user.getUserLite', { userId }).catch(() => null);
      if (userData && userData.skills && userData.leveling && userData.leveling.level >= SCAN_CONFIG.minLevel) {
        users.push(userData);
      }
      await sleep(200); // Extra delay between user fetches
    }

    return calculatePopulationStats(countryId, users, allUserIds.length);
  } catch (err) {
    console.error('Deep scan failed:', err);
    return null;
  }
}

function calculatePopulationStats(countryId, users, totalPopulation) {
  const countryName = resolveCountry(countryId);
  const pop = totalPopulation || users.length;

  // Skill thresholds
  const WAR_SKILLS = ['attack', 'criticalChance', 'criticalDamages', 'armor', 'precision', 'dodge'];
  const ECO_SKILLS = ['companies', 'entrepreneurship', 'production', 'management'];
  const WAR_THRESHOLD = 3; // Level 3+ considered "specced"
  const ECO_THRESHOLD = 3;

  let warSpecced = 0;
  let ecoSpecced = 0;
  let buffed = 0;
  let debuffed = 0;
  let neutral = 0;

  // Skill level distributions
  const skillLevels = {};

  for (const user of users) {
    const skills = user.skills || {};

    // Check war spec
    let warLevel = 0;
    for (const skill of WAR_SKILLS) {
      const level = skills[skill]?.level || 0;
      warLevel = Math.max(warLevel, level);

      // Track distribution
      if (!skillLevels[skill]) skillLevels[skill] = {};
      skillLevels[skill][level] = (skillLevels[skill][level] || 0) + 1;
    }

    // Check eco spec
    let ecoLevel = 0;
    for (const skill of ECO_SKILLS) {
      const level = skills[skill]?.level || 0;
      ecoLevel = Math.max(ecoLevel, level);

      if (!skillLevels[skill]) skillLevels[skill] = {};
      skillLevels[skill][level] = (skillLevels[skill][level] || 0) + 1;
    }

    if (warLevel >= WAR_THRESHOLD) warSpecced++;
    if (ecoLevel >= ECO_THRESHOLD) ecoSpecced++;

    // Check buff/debuff status
    const attackSkill = skills.attack;
    if (attackSkill) {
      const buffs = attackSkill.buffsPercent || 0;
      const debuffs = attackSkill.debuffsPercent || 0;

      if (buffs > 0) buffed++;
      else if (debuffs > 0) debuffed++;
      else neutral++;
    }
  }

  const total = users.length;

  return {
    countryId,
    countryName,
    population: pop,
    samples: total,
    warSpecced: total > 0 ? (warSpecced / total * 100) : 0,
    ecoSpecced: total > 0 ? (ecoSpecced / total * 100) : 0,
    buffed: total > 0 ? (buffed / total * 100) : 0,
    debuffed: total > 0 ? (debuffed / total * 100) : 0,
    neutral: total > 0 ? (neutral / total * 100) : 0,
    skillLevels
  };
}

function renderScanResults() {
  const container = document.getElementById('scanResults');
  if (!container) return;

  const countryIds = Object.keys(scanResults);
  if (countryIds.length === 0) {
    container.innerHTML = '<div class="loading">No scan results yet</div>';
    return;
  }

  container.innerHTML = countryIds.map(countryId => {
    const result = scanResults[countryId];
    return renderScanCountryCard(result);
  }).join('');
}

function renderScanCountryCard(result) {
  const {
    countryName,
    population,
    samples,
    warSpecced,
    ecoSpecced,
    buffed,
    debuffed,
    neutral,
    skillLevels
  } = result;

  // Render skill distributions
  const warSkillBars = renderSkillBars(skillLevels, ['attack', 'criticalChance', 'criticalDamages', 'armor', 'precision', 'dodge']);
  const ecoSkillBars = renderSkillBars(skillLevels, ['companies', 'entrepreneurship', 'production', 'management']);

  return `
    <div class="scan-country-card">
      <div class="scan-country-header">
        <span class="scan-country-name">${countryName}</span>
        <span class="scan-country-pop">Pop: ${formatNumber(population)} | Sample: ${samples}</span>
      </div>
      <div class="scan-stats-grid">
        <div class="scan-stat-block">
          <div class="scan-stat-title">War Skills</div>
          <div class="scan-stat-bars">${warSkillBars}</div>
        </div>
        <div class="scan-stat-block">
          <div class="scan-stat-title">Eco Skills</div>
          <div class="scan-stat-bars">${ecoSkillBars}</div>
        </div>
        <div class="scan-stat-block">
          <div class="scan-stat-title">Buff/Debuff</div>
          <div class="scan-stat-bars">
            ${renderBar('Buffed', buffed, 'buff')}
            ${renderBar('Debuffed', debuffed, 'debuff')}
            ${renderBar('Neutral', neutral, 'neutral')}
          </div>
        </div>
      </div>
      <div class="scan-spec-summary">
        <span class="scan-spec-tag war">War: ${warSpecced.toFixed(0)}%</span>
        <span class="scan-spec-tag eco">Eco: ${ecoSpecced.toFixed(0)}%</span>
      </div>
      <div class="scan-samples-note">Based on ${samples} sampled users</div>
    </div>
  `;
}

function renderSkillBars(skillLevels, skills) {
  // Human-readable skill names
  const skillNames = {
    attack: 'Attack',
    criticalChance: 'Crit Chance',
    criticalDamages: 'Crit Dmg',
    armor: 'Armor',
    precision: 'Precision',
    dodge: 'Dodge',
    companies: 'Companies',
    entrepreneurship: 'Entrepreneurship',
    production: 'Production',
    management: 'Management'
  };

  if (!skills || skills.length === 0) return '';

  return skills.map(skill => {
    const levels = skillLevels[skill] || {};
    const maxLevel = Object.keys(levels).reduce((max, l) => Math.max(max, parseInt(l)), 0);
    const topLevel = Math.min(maxLevel, 10); // Show up to level 10

    const displayName = skillNames[skill] || skill.charAt(0).toUpperCase() + skill.slice(1);

    let bars = `<div class="skill-group-label">${displayName}</div>`;
    for (let level = 0; level <= topLevel; level++) {
      const count = levels[level] || 0;
      const pct = count > 0 ? (count / Object.values(levels).reduce((a, b) => a + b, 0) * 100) : 0;
      bars += renderBar(`Lv${level}`, pct, 'neutral');
    }

    return bars;
  }).join('');
}

function renderBar(label, value, colorClass) {
  return `
    <div class="scan-stat-bar-row">
      <span class="scan-stat-label">${label}</span>
      <div class="scan-stat-bar-bg">
        <div class="scan-stat-bar-fill ${colorClass}" style="width: ${value}%"></div>
      </div>
      <span class="scan-stat-value">${value.toFixed(0)}%</span>
    </div>
  `;
}

function updateScanUI(state) {
  const statusEl = document.getElementById('scanStatus');
  const progressEl = document.getElementById('scanProgress');
  const buttons = document.querySelectorAll('.scan-btn');

  buttons.forEach(btn => btn.disabled = (state === 'scanning'));

  if (state === 'scanning') {
    progressEl.style.display = 'block';
    statusEl.textContent = 'Scanning...';
  } else if (state === 'ready') {
    progressEl.style.display = 'none';
    statusEl.textContent = 'Ready';
  }
}

function updateScanProgress(percent) {
  const bar = document.getElementById('progressBar');
  if (bar) {
    bar.style.width = `${percent}%`;
  }
}

function updateScanStatus(text) {
  const statusEl = document.getElementById('scanStatus');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

// --- Init ---

async function init() {
  // Load country names first (needed for all lookups)
  await fetchAllCountries();
  await fetchAllRegions();

  // Wire up search input
  const searchInput = document.getElementById('countrySearchInput');
  const selectorWrap = document.querySelector('.selector-input-wrap');
  if (searchInput) {
    searchInput.addEventListener('focus', () => {
      document.getElementById('selectorDropdown')?.classList.add('open');
    });
    searchInput.addEventListener('input', (e) => {
      const filter = e.target.value;
      renderCountryList(allCountriesList, filter);
    });
  }

  // Click on input wrap to toggle dropdown
  if (selectorWrap) {
    selectorWrap.addEventListener('click', (e) => {
      const dropdown = document.getElementById('selectorDropdown');
      if (dropdown) {
        dropdown.classList.toggle('open');
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('selectorDropdown');
    const selector = document.querySelector('.country-selector');
    if (dropdown && selector && !selector.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Initial data fetch
  await fetchEvents();
  await fetchRankings();
  await fetchBattles();
  await fetchCountryIntel();

  // Start heartbeats
  setInterval(fetchEvents, 30000);
  setInterval(fetchRankings, 60000);
  setInterval(fetchBattles, 60000);
  setInterval(fetchCountryIntel, 120000);

  updateStatus('live');
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

init();
