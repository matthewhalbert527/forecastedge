export interface WeatherDatasetReference {
  id: string;
  name: string;
  purpose: string;
  access: "public" | "api_key_required" | "paid_or_limited";
  url: string;
  notes: string;
}

export const WEATHER_DATASET_REFERENCES: WeatherDatasetReference[] = [
  {
    id: "kalshi-product-rules",
    name: "Kalshi product certifications and market rules",
    purpose: "Authoritative settlement source, station, threshold, and date interpretation.",
    access: "public",
    url: "https://kalshi-public-docs.s3.us-east-1.amazonaws.com/regulatory/product-certifications/CITIESWEATHER.pdf",
    notes: "Market-specific rules remain authoritative; parser should prefer rule text over title heuristics."
  },
  {
    id: "nws-daily-climate-report",
    name: "NWS Daily Climatological Report",
    purpose: "Final high/low settlement value for many Kalshi temperature markets.",
    access: "public",
    url: "https://www.weather.gov/",
    notes: "Use station and WFO-specific CLI pages where possible; preserve revisions for audit."
  },
  {
    id: "nws-api-observations",
    name: "NWS API station observations",
    purpose: "Near-real-time station observations at the settlement station.",
    access: "public",
    url: "https://api.weather.gov/stations/{stationId}/observations",
    notes: "Useful for intraday mark and late-day probability, but CLI can differ due to reporting and rounding."
  },
  {
    id: "noaa-isd",
    name: "NOAA Integrated Surface Database",
    purpose: "Large historical ASOS/AWOS station observations for calibration.",
    access: "public",
    url: "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database",
    notes: "Best long-run calibration source for station bias and temperature error distribution."
  },
  {
    id: "noaa-cdo",
    name: "NOAA Climate Data Online",
    purpose: "Official daily summaries and station history for model backtests.",
    access: "api_key_required",
    url: "https://www.ncei.noaa.gov/cdo-web/webservices/v2",
    notes: "Requires NOAA token. Prefer for structured daily historical highs/lows."
  },
  {
    id: "open-meteo-historical-forecast",
    name: "Open-Meteo Historical Forecast API",
    purpose: "Backtest forecast error by forecast run and horizon.",
    access: "public",
    url: "https://open-meteo.com/en/docs/historical-forecast-api",
    notes: "Use station coordinates, not city centroids, to calibrate forecast error."
  },
  {
    id: "accuweather",
    name: "AccuWeather APIs",
    purpose: "Only use as authoritative if a specific market rule says AccuWeather, otherwise treat as a secondary forecast provider.",
    access: "api_key_required",
    url: "https://developer.accuweather.com/apis",
    notes: "Requires an API key and AccuWeather location keys."
  }
];
