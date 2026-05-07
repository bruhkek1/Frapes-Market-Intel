const API = 'https://api2.warera.io/trpc';
const REFRESH_PRICES = 30000;   // 30s
const REFRESH_JOBS = 60000;     // 60s
const REFRESH_ANALYTICS = 120000; // 2min
const SPARKLINE_POINTS = 40;    // ~20 minutes of history
const CORRELATION_WINDOW = 30;  // Points for correlation calc

let priceInterval = null;
let jobInterval = null;
let analyticsInterval = null;
let priceHistory = {};          // Previous snapshot for change detection
let priceSparklines = {};       // Array of historical prices per item
let companyCache = {};          // Company ID -> name cache
let spreadHistory = {};         // Track spreads over time
let volatilityData = {};        // Store volatility calculations
let correlationMatrix = {};     // Store correlations between items
let itemPrices = {};            // Current prices for calculations
let itemSpreads = {};           // Current spreads per item (%)
let itemAbsoluteSpread = {};    // Actual profit per trade (bestSell - bestBuy)
let itemVolumes = {};           // Total buy+sell volume per item
let previousItemVolumes = {};   // Previous scan volumes for trend detection
let trendingItem = null;        // Item with biggest volume spike
const MIN_ABSOLUTE_SPREAD = 0.01; // Items below this are deprioritized

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

// --- Company Name Resolution ---

async function resolveCompanyNames(companyIds) {
  const toFetch = [...new Set(companyIds)].filter(id => !companyCache[id]);
  
  if (toFetch.length === 0) return;
  
  const promises = toFetch.map(id => 
    callAPI('company.getById', { companyId: id })
      .then(company => {
        if (company) {
          companyCache[id] = company.name || company.companyName || 
            company.title || `#${id.substring(0, 8)}`;
        } else {
          companyCache[id] = `#${id.substring(0, 8)}`;
        }
      })
      .catch(() => {
        companyCache[id] = `#${id.substring(0, 8)}`;
      })
  );
  
  await Promise.allSettled(promises);
}

// --- Prices ---

async function fetchPrices() {
  const prices = await callAPI('itemTrading.getPrices');
  if (!prices) return updateStatus('error', 'Price fetch failed');

  itemPrices = prices; // Store for calculations

  // Update sparkline history
  for (const [item, price] of Object.entries(prices)) {
    if (!priceSparklines[item]) {
      priceSparklines[item] = [];
    }
    priceSparklines[item].push(price);
    if (priceSparklines[item].length > SPARKLINE_POINTS) {
      priceSparklines[item].shift();
    }
  }

  renderPrices(prices);
  populateItemChips(prices);
  updateAlertSuggestions(Object.keys(prices));
  updateStatus('live');
  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
  document.getElementById('itemCount').textContent = `${Object.keys(prices).length} items`;
}

function renderPrices(prices) {
  const grid = document.getElementById('priceGrid');

  // Helper: compute a sort score that prioritizes tradeable items
  function getSortScore(name) {
    const absSpread = parseFloat(itemAbsoluteSpread[name]) || 0;
    const pctSpread = parseFloat(itemSpreads[name]) || 0;
    // Items with absolute spread < MIN_ABSOLUTE_SPREAD get penalized heavily
    if (absSpread < MIN_ABSOLUTE_SPREAD) {
      return -1000 + absSpread; // Push to bottom, but still sort by abs spread among themselves
    }
    return absSpread; // Sort by actual profit per unit
  }

  const entries = Object.entries(prices).sort((a, b) => {
    return getSortScore(b[0]) - getSortScore(a[0]);
  });

  // Find top 5 most traded items (only ones worth trading)
  const topVolumes = Object.entries(itemVolumes)
    .filter(([name]) => (parseFloat(itemAbsoluteSpread[name]) || 0) >= MIN_ABSOLUTE_SPREAD)
    .sort((a, b) => b[1] - a[1]);
  const top5 = topVolumes.slice(0, 5).map(e => e[0]);

  const maxPrice = entries.length ? entries[0][1] : 1;

  const oldPrices = { ...priceHistory };
  priceHistory = { ...prices };

  grid.innerHTML = entries.map(([name, price]) => {
    const pct = (price / maxPrice * 100).toFixed(1);
    const old = oldPrices[name];
    let changeHtml = '';
    if (old !== undefined && old !== price) {
      const diff = ((price - old) / old * 100).toFixed(2);
      const cls = diff > 0 ? 'up' : 'down';
      const arrow = diff > 0 ? '&#9650;' : '&#9660;';
      changeHtml = `<span class="price-change ${cls}">${arrow} ${Math.abs(diff)}%</span>`;
    }

    const sparkline = renderSparkline(name);
    const isTopTraded = top5.includes(name);
    const isTrending = trendingItem === name;
    const volume = itemVolumes[name];
    const absSpread = itemAbsoluteSpread[name];
    const isLowValue = absSpread !== undefined && parseFloat(absSpread) < MIN_ABSOLUTE_SPREAD;

    return `
      <div class="price-row ${isLowValue ? 'low-value' : ''}">
        <span class="price-name">${name}${isTopTraded ? ' <span class="vol-badge" title="Top 5 Most Traded">🔥</span>' : ''}${isTrending ? ' <span class="trend-badge" title="Trending Now!">⚡</span>' : ''}</span>
        <div class="price-middle">
          <div class="price-bar-container">
            <div class="price-bar" style="width:${pct}%"></div>
          </div>
          ${sparkline}
        </div>
        <span class="price-value">${price.toFixed(3)}${changeHtml}</span>
        ${!isLowValue && volume ? `<span class="price-volume" title="Volume: ${volume}">${volume}</span>` : ''}
      </div>
    `;
  }).join('');
}

function renderSparkline(itemName) {
  const history = priceSparklines[itemName];
  if (!history || history.length < 2) return '';

  const width = 80;
  const height = 20;
  const padding = 1;
  
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  const points = history.map((val, i) => {
    const x = padding + (i / (history.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');

  const isUp = history[history.length - 1] >= history[0];
  const color = isUp ? '#6e9e6e' : '#8a4a4a';

  return `
    <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>
    </svg>
  `;
}

function populateItemChips(prices) {
  const container = document.getElementById('itemChips');
  const entries = Object.entries(prices);

  // Same sort logic as renderPrices
  function getSortScore(name) {
    const absSpread = parseFloat(itemAbsoluteSpread[name]) || 0;
    const pctSpread = parseFloat(itemSpreads[name]) || 0;
    if (absSpread < MIN_ABSOLUTE_SPREAD) {
      return -1000 + absSpread;
    }
    return absSpread;
  }

  entries.sort((a, b) => getSortScore(b[0]) - getSortScore(a[0]));

  // Top 5 most traded (only ones worth trading)
  const topVolumes = Object.entries(itemVolumes)
    .filter(([name]) => (parseFloat(itemAbsoluteSpread[name]) || 0) >= MIN_ABSOLUTE_SPREAD)
    .sort((a, b) => b[1] - a[1]);
  const top5 = topVolumes.slice(0, 5).map(e => e[0]);

  container.innerHTML = entries.map(([name, price]) => {
    const spread = itemSpreads[name];
    const volume = itemVolumes[name] || 0;
    const isTopTraded = top5.includes(name);
    const isTrending = trendingItem === name;
    const absSpread = itemAbsoluteSpread[name];
    const isLowValue = absSpread !== undefined && parseFloat(absSpread) < MIN_ABSOLUTE_SPREAD;

    let spreadIndicator = '';
    if (spread !== undefined) {
      const spreadVal = parseFloat(spread);
      let color, icon;
      if (spreadVal > 1.0) { color = 'var(--yellow)'; icon = '▲▲'; }
      else if (spreadVal > 0.5) { color = 'var(--olive)'; icon = '▲'; }
      else { color = 'var(--green-bright)'; icon = '●'; }
      spreadIndicator = `<span class="spread-indicator-chip" style="color:${color}" title="Spread: ${spreadVal.toFixed(2)}% | Profit/unit: ${absSpread || '?'}">${icon}</span>`;
    }

    const volBadge = isTopTraded ? `<span class="vol-badge" title="Top 5 Most Traded">🔥</span>` : '';
    const trendBadge = isTrending ? `<span class="trend-badge" title="Trending Now!">⚡</span>` : '';
    const volText = volume > 0 && !isLowValue ? `<span class="chip-volume" title="Volume: ${volume}">(${volume})</span>` : '';

    return `
      <div class="item-chip ${isLowValue ? 'low-value' : ''}" data-item="${name}" onclick="selectItem('${name}')">
        ${name}
        <span class="chip-price">${price.toFixed(2)}</span>
        ${volText}${spreadIndicator}${volBadge}${trendBadge}
      </div>
    `;
  }).join('');
}

// Global function for chip clicks
window.selectItem = async function(itemName) {
  // Update active state
  document.querySelectorAll('.item-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.item === itemName);
  });
  
  // Fetch orders
  await fetchOrders(itemName);
};

// Global function to copy price to clipboard
window.copyPrice = function(price) {
  navigator.clipboard.writeText(price).then(() => {
    // Show toast notification
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = `Copied ${price}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  });
};

// --- Orders ---

async function fetchOrders(itemCode) {
  const orders = await callAPI('tradingOrder.getTopOrders', { itemCode, limit: 10 });
  if (!orders) {
    document.getElementById('orderBook').innerHTML =
      '<p class="placeholder">Failed to load orders</p>';
    return;
  }
  renderOrders(orders, itemCode);
}

function renderOrders(orders, itemCode) {
  const container = document.getElementById('orderBook');
  const buyOrders = orders.buyOrders || [];
  const sellOrders = orders.sellOrders || [];

  // Calculate volume analysis
  const buyVolume = buyOrders.reduce((sum, o) => sum + o.quantity, 0);
  const sellVolume = sellOrders.reduce((sum, o) => sum + o.quantity, 0);
  const totalVolume = buyVolume + sellVolume;
  const buyPct = totalVolume ? (buyVolume / totalVolume * 100).toFixed(1) : 50;
  const sellPct = totalVolume ? (sellVolume / totalVolume * 100).toFixed(1) : 50;
  
  // Liquidity score (0-100 based on order count and volume)
  const liquidityScore = Math.min(100, (buyOrders.length + sellOrders.length) * 5 + totalVolume * 2);
  const liquidityColor = liquidityScore > 70 ? 'var(--green-bright)' : 
                         liquidityScore > 40 ? 'var(--olive)' : 'var(--yellow)';

  // Calculate spread
  const bestBuy = buyOrders.length ? buyOrders[0].price : 0;
  const bestSell = sellOrders.length ? sellOrders[0].price : 0;
  const spread = bestBuy && bestSell ? ((bestSell - bestBuy) / bestBuy * 100).toFixed(3) : null;
  
  // Track spread history
  if (spread) {
    if (!spreadHistory[itemCode]) spreadHistory[itemCode] = [];
    spreadHistory[itemCode].push({ time: Date.now(), spread: parseFloat(spread) });
    if (spreadHistory[itemCode].length > 20) spreadHistory[itemCode].shift();
  }

  let html = `<div class="item-title">${itemCode}</div>`;
  
  // Quick trade section - optimal prices to beat orders
  if (bestBuy && bestSell) {
    const buyPrice = (parseFloat(bestBuy) + 0.001).toFixed(3);
    const sellPrice = (parseFloat(bestSell) - 0.001).toFixed(3);
    const profit = (parseFloat(sellPrice) - parseFloat(buyPrice)).toFixed(3);
    const profitPct = ((profit / parseFloat(buyPrice)) * 100).toFixed(3);
    
    html += `
      <div class="quick-trade">
        <div class="quick-trade-label">Quick Trade Prices</div>
        <div class="quick-trade-row">
          <button class="trade-btn buy-btn" onclick="copyPrice('${buyPrice}')" title="Click to copy">
            Buy at ${buyPrice}
          </button>
          <div class="trade-profit">
            <span class="profit-value" style="color:${parseFloat(profit) > 0 ? 'var(--green-bright)' : 'var(--red)'}">
              ${parseFloat(profit) > 0 ? '+' : ''}${profit} (${profitPct}%)
            </span>
          </div>
          <button class="trade-btn sell-btn" onclick="copyPrice('${sellPrice}')" title="Click to copy">
            Sell at ${sellPrice}
          </button>
        </div>
      </div>
    `;
  }
  
  // Volume analysis bar
  html += `
    <div class="volume-analysis">
      <div class="volume-bar">
        <div class="volume-buy" style="width:${buyPct}%"></div>
        <div class="volume-sell" style="width:${sellPct}%"></div>
      </div>
      <div class="volume-stats">
        <span class="buy-stat">${buyVolume} buy</span>
        <span class="sell-stat">${sellVolume} sell</span>
        <span class="liquidity" style="color:${liquidityColor}">Liq: ${liquidityScore.toFixed(0)}</span>
      </div>
    </div>
  `;
  
  if (spread !== null) {
    const spreadColor = parseFloat(spread) < 0.5 ? 'var(--green-bright)' : 
                        parseFloat(spread) < 1.0 ? 'var(--olive)' : 'var(--yellow)';
    html += `<div class="spread-indicator" style="color:${spreadColor}">
      Spread: ${spread}%
    </div>`;
  }

  if (buyOrders.length) {
    html += `<div class="order-section"><h3 class="buy">Buy Orders (${buyOrders.length})</h3>`;
    html += buyOrders.map(o => `
      <div class="order-row buy-row">
        <span>${o.quantity}x</span>
        <span>${o.price.toFixed(3)}</span>
        <span>${timeAgo(o.offerAt)}</span>
      </div>
    `).join('');
    html += '</div>';
  }

  if (sellOrders.length) {
    html += `<div class="order-section"><h3 class="sell">Sell Orders (${sellOrders.length})</h3>`;
    html += sellOrders.map(o => `
      <div class="order-row sell-row">
        <span>${o.quantity}x</span>
        <span>${o.price.toFixed(3)}</span>
        <span>${timeAgo(o.offerAt)}</span>
      </div>
    `).join('');
    html += '</div>';
  }

  if (!buyOrders.length && !sellOrders.length) {
    html += '<p class="placeholder">No active orders</p>';
  }

  container.innerHTML = html;
}

// --- Spread Scanner ---

async function scanAllSpreads() {
  const items = Object.keys(itemPrices);
  const spreadPromises = items.map(async (item) => {
    const orders = await callAPI('tradingOrder.getTopOrders', { itemCode: item, limit: 10 });
    if (orders) {
      const bestBuy = orders.buyOrders?.[0]?.price || 0;
      const bestSell = orders.sellOrders?.[0]?.price || 0;
      if (bestBuy && bestSell) {
        itemSpreads[item] = ((bestSell - bestBuy) / bestBuy * 100).toFixed(3);
        itemAbsoluteSpread[item] = (bestSell - bestBuy).toFixed(3);
      }
      // Track total volume
      const buyVol = (orders.buyOrders || []).reduce((s, o) => s + o.quantity, 0);
      const sellVol = (orders.sellOrders || []).reduce((s, o) => s + o.quantity, 0);
      itemVolumes[item] = buyVol + sellVol;

      // Check alerts for watched items
      evaluateAlert(item, orders);
    }
  });

  await Promise.allSettled(spreadPromises);

  // Detect trending item: biggest volume increase vs previous scan
  // Only consider items that pass our minimum spread criteria
  let maxSpike = 0;
  trendingItem = null;
  for (const [item, vol] of Object.entries(itemVolumes)) {
    if ((parseFloat(itemAbsoluteSpread[item]) || 0) < MIN_ABSOLUTE_SPREAD) continue;
    const prevVol = previousItemVolumes[item] || 0;
    const spike = vol - prevVol;
    if (spike > maxSpike && spike >= 20) { // Minimum 20 unit increase to count
      maxSpike = spike;
      trendingItem = item;
    }
  }

  // Save current volumes for next comparison
  previousItemVolumes = { ...itemVolumes };

  // Refresh chips and price grid with new data
  populateItemChips(itemPrices);
  renderPrices(itemPrices);

  // Set next scan time for timer
  nextScanTime = Date.now() + 60000;
  startScanTimer();
}

// --- Analytics ---

async function fetchAnalytics() {
  // Calculate volatility for all items
  calculateVolatility();
  
  // Calculate correlations
  calculateCorrelations();
  
  // Render analytics panel
  renderAnalytics();
}

function calculateVolatility() {
  const items = Object.keys(priceSparklines);

  items.forEach(item => {
    const history = priceSparklines[item];
    if (history.length < 3) return;

    // Calculate standard deviation of price changes
    const changes = [];
    for (let i = 1; i < history.length; i++) {
      changes.push((history[i] - history[i-1]) / history[i-1]);
    }

    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / changes.length;
    const volatility = Math.sqrt(variance) * 100; // Percentage

    volatilityData[item] = {
      volatility: volatility.toFixed(3),
      direction: history[history.length-1] > history[0] ? 'up' : 'down',
      change: ((history[history.length-1] - history[0]) / history[0] * 100).toFixed(2)
    };
  });
}

function calculateCorrelations() {
  // Only correlate top 10 items by volume to keep it fast
  const allItems = Object.entries(itemVolumes).sort((a, b) => b[1] - a[1]);
  const items = allItems.slice(0, 10).map(e => e[0]);
  correlationMatrix = {};

  // Only calculate if we have enough data points
  if (items.length < 2) return;

  items.forEach(item1 => {
    correlationMatrix[item1] = {};
    const history1 = priceSparklines[item1];

    items.forEach(item2 => {
      if (item1 === item2) {
        correlationMatrix[item1][item2] = 1;
        return;
      }

      const history2 = priceSparklines[item2];
      const minLen = Math.min(history1?.length || 0, history2?.length || 0, CORRELATION_WINDOW);

      if (minLen < 5) {
        correlationMatrix[item1][item2] = 0;
        return;
      }

      // Calculate Pearson correlation
      const h1 = history1.slice(-minLen);
      const h2 = history2.slice(-minLen);
      
      const mean1 = h1.reduce((a, b) => a + b, 0) / h1.length;
      const mean2 = h2.reduce((a, b) => a + b, 0) / h2.length;
      
      let numerator = 0;
      let denom1 = 0;
      let denom2 = 0;
      
      for (let i = 0; i < minLen; i++) {
        const diff1 = h1[i] - mean1;
        const diff2 = h2[i] - mean2;
        numerator += diff1 * diff2;
        denom1 += diff1 * diff1;
        denom2 += diff2 * diff2;
      }
      
      const correlation = numerator / Math.sqrt(denom1 * denom2);
      correlationMatrix[item1][item2] = isNaN(correlation) ? 0 : correlation;
    });
  });
}

function renderAnalytics() {
  // Volatility ranking
  const volContainer = document.getElementById('volatilityRanking');
  if (!volContainer) return;

  const volItems = Object.entries(volatilityData)
    .filter(([_, data]) => data.volatility > 0)
    .sort((a, b) => b[1].volatility - a[1].volatility);

  if (volItems.length === 0) {
    volContainer.innerHTML = '<p class="placeholder">Collecting volatility data... (~1 min)</p>';
    return;
  }

  const volNote = volItems.length < 5 ? '<p class="placeholder" style="margin-top:4px;font-size:0.7rem;">Partial data — warming up</p>' : '';

  volContainer.innerHTML = volItems.map(([item, data]) => {
    const volColor = data.volatility > 2 ? 'var(--yellow)' : 
                     data.volatility > 1 ? 'var(--olive)' : 'var(--green-bright)';
    const dirIcon = data.direction === 'up' ? '▲' : '▼';
    const dirColor = data.direction === 'up' ? 'var(--green-bright)' : 'var(--red)';

    return `
      <div class="vol-row">
        <span class="vol-item">${item}</span>
        <span class="vol-value" style="color:${volColor}">${data.volatility}%</span>
        <span class="vol-change" style="color:${dirColor}">${dirIcon} ${Math.abs(data.change)}%</span>
      </div>
    `;
  }).join('') + volNote;

  // Correlation matrix (top 5 most correlated pairs)
  const corrContainer = document.getElementById('correlationMatrix');
  if (!corrContainer) return;

  const correlations = [];
  const items = Object.keys(correlationMatrix);

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const corr = correlationMatrix[items[i]]?.[items[j]];
      if (corr && Math.abs(corr) > 0.5) { // Only show significant correlations
        correlations.push({
          item1: items[i],
          item2: items[j],
          value: corr
        });
      }
    }
  }

  correlations.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  if (correlations.length === 0) {
    corrContainer.innerHTML = '<p class="placeholder">Collecting correlation data... (~2 min)</p>';
    return;
  }

  const corrNote = correlations.length < 3 ? '<p class="placeholder" style="margin-top:4px;font-size:0.7rem;">Partial data — warming up</p>' : '';

  corrContainer.innerHTML = correlations.slice(0, 5).map(pair => {
    const corrColor = pair.value > 0 ? 'var(--green-bright)' : 'var(--red)';
    const strength = Math.abs(pair.value) > 0.8 ? 'Strong' : 
                     Math.abs(pair.value) > 0.6 ? 'Moderate' : 'Weak';

    return `
      <div class="corr-row">
        <span class="corr-pair">${pair.item1} ↔ ${pair.item2}</span>
        <span class="corr-value" style="color:${corrColor}">${(pair.value * 100).toFixed(1)}%</span>
        <span class="corr-strength">${strength}</span>
      </div>
    `;
  }).join('') + corrNote;
}

// --- Jobs ---

async function fetchJobs() {
  const jobs = await callAPI('workOffer.getWorkOffersPaginated', { limit: 15 });
  if (!jobs) return;
  
  const companyIds = (jobs.items || []).map(j => j.company).filter(Boolean);
  if (companyIds.length > 0) {
    await resolveCompanyNames(companyIds);
  }
  
  renderJobs(jobs);
}

function renderJobs(data) {
  const list = document.getElementById('jobList');
  const items = data.items || [];

  if (!items.length) {
    list.innerHTML = '<p class="placeholder">No active jobs</p>';
    document.getElementById('jobCount').textContent = '0 jobs';
    return;
  }

  items.sort((a, b) => (b.wageAfterTax || b.wage) - (a.wageAfterTax || a.wage));

  document.getElementById('jobCount').textContent = `${items.length} jobs`;

  list.innerHTML = `
    <div class="job-header">
      <span>Company</span>
      <span style="text-align:right">Wage</span>
      <span style="text-align:right">Energy</span>
      <span style="text-align:right">Production</span>
    </div>
  ` + items.map(j => {
    const companyName = companyCache[j.company] || `#${j.company.substring(0, 8)}`;
    return `
    <div class="job-row">
      <span class="job-company" title="${j.company}">${companyName}</span>
      <span class="job-wage">${(j.wageAfterTax || j.wage).toFixed(3)}</span>
      <span class="job-energy">${j.minEnergy || '-'}</span>
      <span class="job-production">${j.minProduction || '-'}</span>
    </div>
  `;}).join('');
}

// --- Alert System ---

let alertWatchList = {};   // item -> { bestBuy, bestSell }
let alertHistory = [];     // Recent alerts for display
let nextScanTime = null;   // Timestamp of next scan
let scanTimerInterval = null;
let audioCtx = null;       // Shared AudioContext (initialized on user gesture)

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function startScanTimer() {
  if (scanTimerInterval) clearInterval(scanTimerInterval);
  scanTimerInterval = setInterval(updateScanTimer, 1000);
  updateScanTimer();
}

function updateScanTimer() {
  const timerEl = document.getElementById('alertTimer');
  if (!timerEl || !nextScanTime) return;

  const remaining = Math.max(0, Math.ceil((nextScanTime - Date.now()) / 1000));
  timerEl.textContent = `Next scan: ${remaining}s`;

  if (remaining <= 0) {
    timerEl.textContent = 'Scanning...';
  }
}

window.addAlertWatch = function() {
  const input = document.getElementById('alertItemInput');
  const itemName = input.value.trim();
  if (!itemName || alertWatchList[itemName]) return;

  // Init audio on user gesture (browsers block audio without it)
  initAudioContext();

  if (document.getElementById('alertNotifToggle').checked && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  alertWatchList[itemName] = { bestBuy: 0, bestSell: Infinity };
  input.value = '';
  renderAlertList();
  console.log(`[Alert] Now watching: ${itemName}`);
};

window.removeAlertWatch = function(itemName) {
  delete alertWatchList[itemName];
  renderAlertList();
};

function evaluateAlert(itemName, orders) {
  const watch = alertWatchList[itemName];
  if (!watch) return;

  const bestBuy = orders.buyOrders?.[0]?.price || 0;
  const bestSell = orders.sellOrders?.[0]?.price || 0;
  const soundOn = document.getElementById('alertSoundToggle')?.checked ?? true;
  const notifOn = document.getElementById('alertNotifToggle')?.checked ?? true;

  // First scan for this item — set baseline, no alert
  if (!watch.baselineSet) {
    if (bestBuy > 0) watch.bestBuy = bestBuy;
    if (bestSell > 0) watch.bestSell = bestSell;
    watch.baselineSet = true;
    renderAlertList();
    console.log(`[Alert] Baseline set for ${itemName}: Buy=${bestBuy.toFixed(3)} Sell=${bestSell.toFixed(3)}`);
    return;
  }

  let triggered = false;
  let messages = [];

  if (bestBuy > 0 && bestBuy > watch.bestBuy) {
    messages.push(`BUY ${itemName}: ${watch.bestBuy.toFixed(3)} -> ${bestBuy.toFixed(3)}`);
    triggered = true;
  }

  if (bestSell > 0 && bestSell < watch.bestSell) {
    messages.push(`SELL ${itemName}: ${watch.bestSell.toFixed(3)} -> ${bestSell.toFixed(3)}`);
    triggered = true;
  }

  // Update tracked prices
  if (bestBuy > 0) watch.bestBuy = bestBuy;
  if (bestSell > 0) watch.bestSell = bestSell;

  if (triggered) {
    console.log(`[Alert] TRIGGERED: ${messages.join(' | ')}`);
  } else {
    console.log(`[Alert] No change for ${itemName}: Buy=${bestBuy.toFixed(3)} Sell=${bestSell.toFixed(3)} (baseline: Buy=${watch.bestBuy.toFixed(3)} Sell=${watch.bestSell.toFixed(3)})`);
  }

  if (triggered) {
    for (const msg of messages) {
      alertHistory.unshift({ time: new Date().toLocaleTimeString(), message: msg });
    }
    alertHistory = alertHistory.slice(0, 10);

    if (soundOn) playAlertSound();
    if (notifOn && Notification.permission === 'granted') {
      new Notification('WarEra Alert', { body: messages.join(' | ') });
    }

    flashAlertPanel();
    renderAlertList();
  }
}

function playAlertSound() {
  try {
    if (!audioCtx) initAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.stop(audioCtx.currentTime + 0.5);
    console.log('[Alert] Sound played');
  } catch (e) {
    console.error('[Alert] Sound failed:', e);
  }
}

function flashAlertPanel() {
  const panel = document.querySelector('.alerts-panel');
  if (!panel) return;
  panel.classList.add('alert-flash');
  setTimeout(() => panel.classList.remove('alert-flash'), 2000);
}

function renderAlertList() {
  const container = document.getElementById('alertList');
  const countEl = document.getElementById('alertCount');
  const items = Object.keys(alertWatchList);
  countEl.textContent = `${items.length} watching`;

  if (items.length === 0 && alertHistory.length === 0) {
    container.innerHTML = '<p class="placeholder">Add items above to watch for price moves</p>';
    return;
  }

  let html = '';

  if (items.length > 0) {
    html += '<div class="alert-watching">';
    for (const [item, watch] of Object.entries(alertWatchList)) {
      html += `
        <div class="alert-watch-item">
          <span class="alert-item-name">${item}</span>
          <span class="alert-prices">
            Buy: ${watch.bestBuy > 0 ? watch.bestBuy.toFixed(3) : '--'} /
            Sell: ${watch.bestSell < Infinity ? watch.bestSell.toFixed(3) : '--'}
          </span>
          <button class="alert-remove-btn" onclick="removeAlertWatch('${item}')">&times;</button>
        </div>
      `;
    }
    html += '</div>';
  }

  if (alertHistory.length > 0) {
    html += '<div class="alert-history"><h4>Recent Alerts</h4>';
    for (const a of alertHistory) {
      html += `<div class="alert-history-item"><span class="alert-time">${a.time}</span> ${a.message}</div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

// Populate autocomplete suggestions
function updateAlertSuggestions(itemNames) {
  const datalist = document.getElementById('alertItemSuggestions');
  if (!datalist) return;
  datalist.innerHTML = itemNames
    .filter(name => !alertWatchList[name])
    .map(name => `<option value="${name}">`).join('');
}

// --- Utilities ---

function updateStatus(state, msg) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('status');
  dot.className = 'status-dot ' + state;
  text.textContent = state === 'live' ? 'Live' : (msg || state);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'now';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

// --- Init ---

async function init() {
  await fetchPrices();
  await fetchJobs();

  priceInterval = setInterval(fetchPrices, REFRESH_PRICES);
  jobInterval = setInterval(fetchJobs, REFRESH_JOBS);
  analyticsInterval = setInterval(fetchAnalytics, REFRESH_ANALYTICS);
  
  // Initial spread scan, then every 60s
  setTimeout(() => {
    scanAllSpreads();
    setInterval(scanAllSpreads, 60000);
  }, 2000);
}

init();