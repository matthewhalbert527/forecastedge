import type { LocationConfig, SettlementStation } from "../types.js";

export const KALSHI_SETTLEMENT_STATIONS: SettlementStation[] = [
  {
    id: "miami-fl-kmia",
    city: "Miami",
    state: "FL",
    stationId: "KMIA",
    stationName: "Miami International Airport",
    latitude: 25.7959,
    longitude: -80.2870,
    timezone: "America/New_York",
    nwsOffice: "MFL",
    aliases: ["miami", "miami airport", "miami international", "kmia"],
    settlementSource: "nws_daily_climate_report",
    notes: "Known Kalshi Miami temperature settlement station. Use station-level airport observations and NWS CLI, not a generic city forecast."
  },
  {
    id: "chicago-il-kmdw",
    city: "Chicago",
    state: "IL",
    stationId: "KMDW",
    stationName: "Chicago Midway International Airport",
    latitude: 41.7868,
    longitude: -87.7522,
    timezone: "America/Chicago",
    nwsOffice: "LOT",
    aliases: ["chicago", "chicago midway", "midway", "kmdw"],
    settlementSource: "nws_daily_climate_report",
    notes: "Known Kalshi Chicago temperature settlement station."
  },
  {
    id: "nyc-ny-knyc",
    city: "New York",
    state: "NY",
    stationId: "KNYC",
    stationName: "Central Park",
    latitude: 40.7789,
    longitude: -73.9692,
    timezone: "America/New_York",
    nwsOffice: "OKX",
    aliases: ["new york", "nyc", "central park", "knyc"],
    settlementSource: "nws_daily_climate_report",
    notes: "Known Kalshi NYC temperature settlement station."
  },
  {
    id: "austin-tx-katt",
    city: "Austin",
    state: "TX",
    stationId: "KATT",
    stationName: "Austin Camp Mabry",
    latitude: 30.3208,
    longitude: -97.7604,
    timezone: "America/Chicago",
    nwsOffice: "EWX",
    aliases: ["austin", "camp mabry", "katt"],
    settlementSource: "nws_daily_climate_report",
    notes: "Known Kalshi Austin temperature settlement station."
  },
  {
    id: "los-angeles-ca-klax",
    city: "Los Angeles",
    state: "CA",
    stationId: "KLAX",
    stationName: "Los Angeles International Airport",
    latitude: 33.9382,
    longitude: -118.3866,
    timezone: "America/Los_Angeles",
    nwsOffice: "LOX",
    aliases: ["los angeles", "la ", "lax", "los angeles airport", "klax"],
    settlementSource: "nws_daily_climate_report",
    notes: "Common airport station for Los Angeles weather markets; keep market rules authoritative."
  },
  {
    id: "oklahoma-city-ok-kokc",
    city: "Oklahoma City",
    state: "OK",
    stationId: "KOKC",
    stationName: "Oklahoma City Will Rogers Airport",
    latitude: 35.3931,
    longitude: -97.6007,
    timezone: "America/Chicago",
    nwsOffice: "OUN",
    aliases: ["oklahoma city", "okc", "will rogers", "kokc"],
    settlementSource: "nws_daily_climate_report",
    notes: "Station shown in public market summaries for Oklahoma City temperature markets."
  }
];

export function findSettlementStation(text: string): SettlementStation | null {
  const normalized = ` ${text.toLowerCase()} `;
  const direct = KALSHI_SETTLEMENT_STATIONS.find((station) => normalized.includes(station.stationId.toLowerCase()));
  if (direct) return direct;
  return KALSHI_SETTLEMENT_STATIONS.find((station) => station.aliases.some((alias) => normalized.includes(alias))) ?? null;
}

export function stationToLocationConfig(station: SettlementStation, pollingIntervalMinutes = 30): LocationConfig {
  return {
    id: station.id,
    city: station.city,
    state: station.state,
    latitude: station.latitude,
    longitude: station.longitude,
    timezone: station.timezone,
    pollingIntervalMinutes,
    stationId: station.stationId,
    stationName: station.stationName,
    settlementSource: station.settlementSource,
    accuweatherLocationKey: station.accuweatherLocationKey
  };
}
