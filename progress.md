# WarEra Market Intel - Progress Log

## Session 1 — 2026-04-27

### Research & Compliance
- [x] Explored WarEra API at api2.warera.io/docs
- [x] Downloaded OpenAPI spec from /openapi.json
- [x] Tested endpoints: prices (22 items), orders (buy/sell books), jobs
- [x] Verified Discord Rule 3: "data collection and display tools that use the official public API are allowed"
- [x] Confirmed read-only approach — no automation, no trading

### Features Built

#### Core Dashboard
- [x] Military green camo / gray color scheme
- [x] 4-panel layout: Prices, Order Book, Job Board, Analytics
- [x] Price change indicators (up/down arrows with %)
- [x] Relative price bars for visual comparison
- [x] Price history sparklines (SVG mini-charts)
- [x] Company name resolution (company.getById API)

#### Trading Intelligence
- [x] **Order Volume Analysis**
  - Buy vs sell quantity visualization
  - Liquidity scoring (0-100 scale)
  - Color-coded: green (>70), olive (>40), yellow (<40)
  
- [x] **Spread Tracking**
  - Real-time spread calculation between best buy/sell
  - Color-coded: green (<0.5%), olive (<1%), yellow (>1%)
  - Spread history tracking per item

- [x] **Volatility Ranking**
  - Standard deviation of price changes
  - Direction indicator (up/down)
  - Percentage change from session start
  - Sorted by volatility (highest first)

- [x] **Price Correlations**
  - Pearson correlation between all items
  - Shows top 5 most correlated pairs
  - Strength classification (Strong/Moderate/Weak)
  - Positive (green) vs negative (red) correlations

### Data Endpoints Used
| Endpoint | Auth | Refresh | Purpose |
|---|---|---|---|
| itemTrading.getPrices | None | 30s | Live market prices for 22 items |
| tradingOrder.getTopOrders | None | Manual | Buy/sell order book per item |
| workOffer.getWorkOffersPaginated | None | 60s | Active job listings |
| company.getById | None | Cached | Company name resolution |

### Trading Strategies Supported

1. **Spread Scalping**
   - Watch spread indicator for wide spreads (>1%)
   - Place orders in the middle for guaranteed profit
   - Example: Buy at 34.45, sell at 34.85 when spread is 0.80

2. **Trend Following**
   - Green sparkline = demand increasing, consider buying
   - Red sparkline = oversupply, wait for bottom
   - Volatility ranking identifies best items for this strategy

3. **Liquidity Arbitrage**
   - Liquidity score shows how easy it is to enter/exit
   - Low liquidity + high volatility = bigger moves
   - High liquidity = safer for larger trades

4. **Cross-Item Correlations**
   - Correlated items move together
   - If iron spikes, steel/concrete likely follow
   - Buy downstream items before their prices react

5. **Order Book Timing**
   - Volume analysis shows buy vs sell pressure
   - More buy orders = increasing demand
   - More sell orders = oversupply

### Known Limits
- transaction.getPaginatedTransactions requires API token (auth)
- mercenaryContractAuction currently returns empty
- Analytics need ~2 minutes to collect sufficient data
- Correlations require 10+ data points per item

### Next Steps
- [ ] Deploy to GitHub Pages (when ready)
- [ ] Add price alert thresholds
- [ ] Add historical price export
- [ ] Add more correlation visualization options

## Feature Ideas — 2026-04-28

### HIGH IMPACT
1. **Spread Alerts** — Toast notification when any item spread crosses a threshold (e.g., >1%). Configurable per-item or global. No need to stare at the dashboard.
2. **Profit Calculator** — Small panel: type quantity, see potential profit (spread per unit x quantity). Quick mental math replacement.
3. **Order Book Depth Visualization** — Horizontal bar chart of cumulative buy vs sell depth. See walls of orders at a glance.
4. **Best Opportunities Panel** — Dedicated section auto-highlighting top 3 items by: widest spread %, highest volume, biggest trending spike.

### MEDIUM IMPACT
5. **Spread History Tracking** — Track how each items spread changes over time (like sparklines but for spreads). Spot consistent vs temporary spreads.
6. **Price Change Threshold Alerts** — Notify when price moves more than X% in a single refresh. Catch sudden market shifts.
7. **Data Export** — Button to download prices, spreads, volumes as CSV. For offline analysis or daily tracking.
8. **Search/Filter Items** — Text search box to filter chip grid and price list. Focus on specific items.

### LOWER IMPACT
9. **Wage Efficiency Calculator** — Show wage-to-energy ratio for jobs. Pick most efficient work.
10. **Keyboard Shortcuts** — Tab to cycle items, Enter to select, Ctrl+C to copy best buy price.

## Session 2 — 2026-04-28

### Improvements
- [x] **Quick Trade precision fix** — Changed ±0.01 to ±0.001 for tighter undercutting
- [x] **Spread-based sorting** — Items sorted by spread % (highest first) in both price grid and chips
- [x] **Volume tracking** — Scan tracks total buy+sell volume per item (limit:10 orders)
- [x] **Top 5 most traded** — Fire emoji (🔥) badge on top 5 volume items (tradeable only)
- [x] **Low-value item deprioritization** — Items with absolute spread < 0.01 pushed to bottom + dimmed (opacity: 0.45)
- [x] **Volume display** — Volume numbers shown only on tradeable items
- [x] **Profit/unit tooltip** — Spread indicator shows both spread % and actual profit per unit
- [x] **Analytics speed fix** — Volatility threshold 5→3 points, correlations limited to top 10 items, thresholds lowered
| [x] **Trending indicator** — Lightning badge (⚡) on item with biggest recent volume spike (tradeable only) |
| [x] **Intelligence Dashboard** — New `intel.html` page with 4 panels: |
|   - **Events Feed** — Live game events (wars, battles, deposits, peace, alliances) with color-coded type badges |
|   - **Country Rankings** — Top 10 by Wealth/Production/Bounty/Development with tier badges |
|   - **Active Battles** — Ongoing conflicts with attacker/defender, damage stats, round tracking |
|   - **Country Intelligence** — Top 20 countries with wealth, development, allies, wars, unrest, strategic resources |
|   - Separate from trading dashboard, no nav between them |
|   - API endpoints: event.getEventsPaginated, ranking.getRanking, battle.getBattles, country.getCountryById |
|   - Heartbeats: Events 30s, Rankings 60s, Battles 60s, Intel 2m |
