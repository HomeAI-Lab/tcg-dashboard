# TCG Favorites Dashboard

GitHub Pages dashboard for Sneaker Dunk TCG Favorites data.

Dashboard URL:

https://homeai-lab.github.io/tcg-dashboard/

## Data Updates

GitHub Actions runs `source_updater.mjs` automatically every 5 minutes and can also be triggered manually from the Actions tab.

The updater:

- reads the existing favorite products from `tcg_data_cumulative.json`
- refreshes current Sneaker Dunk sales-history API rows
- keeps only `A`, `PSA10`, `BGS10 GL`, and `BGS10 BL`
- appends new rows into the cumulative dataset without deleting old rows
- commits updated data files back to `main`

## Files

- `index.html` is the GitHub Pages dashboard.
- `tcg_data_cumulative.js` is loaded by the dashboard.
- `tcg_data_cumulative.json` is the append-only source data.
- `source_update_status.json` records the latest updater run.
- `.github/workflows/update-data.yml` schedules the automatic update.

## Limitation

The GitHub updater refreshes sales histories for products already present in the cumulative Favorites dataset. If a brand-new card is added to Sneaker Dunk Favorites, the favorite product list must be synced separately.
