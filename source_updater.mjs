import fs from "node:fs";

const cumulativePath = "tcg_data_cumulative.json";
const cumulativeJsPath = "tcg_data_cumulative.js";
const latestPath = "tcg_data.json";
const latestJsPath = "tcg_data.js";
const statusPath = "source_update_status.json";

const allowedConditions = ["A", "PSA10", "BGS10 BL", "BGS10 GL"];
const conditionIds = {
  A: 18,
  PSA10: 22,
  "BGS10 BL": 25,
  "BGS10 GL": 26,
};

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(days) {
  const date = new Date(`${todayIso()}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeSoldDate(raw) {
  const value = String(raw || "").trim();
  const absolute = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (absolute) {
    return `${absolute[1]}-${absolute[2].padStart(2, "0")}-${absolute[3].padStart(2, "0")}`;
  }
  if (/^\d+\s*\u6642\u9593\u524d$/.test(value) || /^\d+\s*\u5206\u524d$/.test(value) || value === "\u305f\u3063\u305f\u4eca") {
    return todayIso();
  }
  const daysAgo = value.match(/^(\d+)\s*\u65e5\u524d$/);
  if (daysAgo) return shiftDate(-Number(daysAgo[1]));
  return "";
}

function saleBaseKey(row) {
  return [row.product_id, row.condition, row.sold_date || "", row.sold_date_raw || "", row.price_jpy].join("|");
}

function addStableSaleKeys(rows) {
  const counts = new Map();
  return rows.map((row) => {
    const base = saleBaseKey(row);
    const occurrence = (counts.get(base) || 0) + 1;
    counts.set(base, occurrence);
    return {
      ...row,
      sale_key: `${base}|${occurrence}`,
      occurrence_index: occurrence,
    };
  });
}

async function fetchSalesHistory(product, condition) {
  const conditionId = conditionIds[condition];
  const apiUrl = `https://snkrdunk.com/v1/apparels/${product.product_id}/sales-history?page=1&per_page=20&condition_id=${conditionId}`;
  const sourceUrl = `https://snkrdunk.com/apparels/${product.product_id}/sales-histories?slide=right`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: "application/json",
      "accept-language": "ja,en-US;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 GitHubActions TCGDashboardUpdater",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const history = Array.isArray(data.history) ? data.history : [];
  return history
    .filter((row) => row.condition === condition)
    .map((row) => ({
      product_id: product.product_id,
      product_name: product.display_name || product.name_en || product.name || "",
      product_url: product.href || product.product_url || `https://snkrdunk.com/apparels/${product.product_id}`,
      brand_group: product.brand_group || "One Piece",
      condition: row.condition,
      sold_date_raw: row.date,
      sold_date: normalizeSoldDate(row.date),
      price_jpy: Number(row.price),
      source_url: sourceUrl,
      product_name_ja: product.name_ja || product.name || "",
      product_name_en: product.display_name || product.name_en || product.name || "",
      image_url: product.image_url || "",
    }));
}

async function run() {
  const startedAt = new Date().toISOString();
  writeJson(statusPath, { status: "running", started_at: startedAt, updated_at: startedAt });

  const existing = readJson(cumulativePath, { metadata: {}, products: [], sales: [], page_audits: [], snapshots: [] });
  const products = existing.products || [];
  const sales = [];
  const pageAudits = [];
  const errors = [];

  for (const product of products) {
    try {
      const productRows = [];
      for (const condition of allowedConditions) {
        productRows.push(...(await fetchSalesHistory(product, condition)));
      }
      sales.push(...productRows);
      pageAudits.push({
        product_id: product.product_id,
        source_url: `https://snkrdunk.com/apparels/${product.product_id}/sales-histories?slide=right`,
        visible_rows: productRows.length,
        traded_conditions: [...new Set(productRows.map((row) => row.condition))],
        capped_conditions_visible_20: allowedConditions.filter(
          (condition) => productRows.filter((row) => row.condition === condition).length >= 20,
        ),
      });
    } catch (error) {
      errors.push({ product_id: product.product_id, message: String(error?.message || error) });
    }
  }

  const latest = {
    metadata: {
      generated_at: new Date().toISOString(),
      scrape_date: todayIso(),
      source_scope: "Sneaker Dunk sales-history API | GitHub Actions automatic source updater",
      favorites_url: "https://snkrdunk.com/accounts/favorites",
      currency: "JPY",
      warning: "GitHub Actions updater refreshes visible sales-history rows for products already present in the cumulative Favorites dataset.",
      updater_errors: errors,
    },
    products,
    sales,
    page_audits: pageAudits,
  };

  writeJson(latestPath, latest);
  fs.writeFileSync(latestJsPath, `window.TCG_DATA = ${JSON.stringify(latest)};\n`, "utf8");

  const productMap = new Map((existing.products || []).map((product) => [product.product_id, product]));
  for (const product of products) productMap.set(product.product_id, { ...(productMap.get(product.product_id) || {}), ...product });

  const existingSales = addStableSaleKeys((existing.sales || []).filter((row) => allowedConditions.includes(row.condition)));
  const saleMap = new Map(existingSales.map((row) => [row.sale_key, row]));
  const latestSales = addStableSaleKeys(sales.filter((row) => allowedConditions.includes(row.condition)));
  let addedSales = 0;

  const now = new Date().toISOString();
  for (const row of latestSales) {
    const previous = saleMap.get(row.sale_key);
    if (previous) {
      saleMap.set(row.sale_key, { ...previous, last_seen_at: now });
    } else {
      saleMap.set(row.sale_key, { ...row, first_seen_at: now, last_seen_at: now });
      addedSales += 1;
    }
  }

  const cumulative = {
    metadata: {
      ...existing.metadata,
      latest_source_generated_at: latest.metadata.generated_at,
      cumulative_updated_at: now,
      currency: "JPY",
      allowed_conditions: allowedConditions,
      condition_policy: "Only A, PSA10, BGS10 GL, and BGS10 BL are retained for active dashboard data and future merges.",
    },
    products: [...productMap.values()].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id))),
    sales: [...saleMap.values()].sort((a, b) =>
      `${a.sold_date || ""}|${a.product_id}|${a.condition}|${a.price_jpy}|${a.occurrence_index}`.localeCompare(
        `${b.sold_date || ""}|${b.product_id}|${b.condition}|${b.price_jpy}|${b.occurrence_index}`,
      ),
    ),
    page_audits: pageAudits,
    snapshots: [
      ...(existing.snapshots || []),
      {
        source_generated_at: latest.metadata.generated_at,
        merged_at: now,
        source_products: products.length,
        source_sales_rows: latestSales.length,
        added_sales_rows: addedSales,
        cumulative_sales_rows: saleMap.size,
      },
    ].slice(-200),
  };

  writeJson(cumulativePath, cumulative);
  fs.writeFileSync(cumulativeJsPath, `window.TCG_DATA = ${JSON.stringify(cumulative)};\n`, "utf8");

  const result = {
    status: errors.length ? "completed_with_errors" : "completed",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    products_checked: products.length,
    source_sales_rows: latestSales.length,
    added_sales_rows: addedSales,
    cumulative_sales_rows: cumulative.sales.length,
    errors,
  };
  writeJson(statusPath, result);
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  const now = new Date().toISOString();
  writeJson(statusPath, { status: "failed", updated_at: now, finished_at: now, message: String(error?.message || error) });
  console.error(error);
  process.exitCode = 1;
});
