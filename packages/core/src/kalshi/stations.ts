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
  },
  {
    id: "boston-ma-kbos",
    city: "Boston",
    state: "MA",
    stationId: "KBOS",
    stationName: "Boston Logan International Airport",
    latitude: 42.3656,
    longitude: -71.0096,
    timezone: "America/New_York",
    nwsOffice: "BOX",
    aliases: ["boston", "logan", "kbos"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "philadelphia-pa-kphl",
    city: "Philadelphia",
    state: "PA",
    stationId: "KPHL",
    stationName: "Philadelphia International Airport",
    latitude: 39.8733,
    longitude: -75.2268,
    timezone: "America/New_York",
    nwsOffice: "PHI",
    aliases: ["philadelphia", "philly", "kphl"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "denver-co-kden",
    city: "Denver",
    state: "CO",
    stationId: "KDEN",
    stationName: "Denver International Airport",
    latitude: 39.8561,
    longitude: -104.6737,
    timezone: "America/Denver",
    nwsOffice: "BOU",
    aliases: ["denver", "kden"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "phoenix-az-kphx",
    city: "Phoenix",
    state: "AZ",
    stationId: "KPHX",
    stationName: "Phoenix Sky Harbor International Airport",
    latitude: 33.4342,
    longitude: -112.0116,
    timezone: "America/Phoenix",
    nwsOffice: "PSR",
    aliases: ["phoenix", "sky harbor", "kphx"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "las-vegas-nv-klas",
    city: "Las Vegas",
    state: "NV",
    stationId: "KLAS",
    stationName: "Harry Reid International Airport",
    latitude: 36.0801,
    longitude: -115.1522,
    timezone: "America/Los_Angeles",
    nwsOffice: "VEF",
    aliases: ["las vegas", "vegas", "harry reid", "klas"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "seattle-wa-ksea",
    city: "Seattle",
    state: "WA",
    stationId: "KSEA",
    stationName: "Seattle-Tacoma International Airport",
    latitude: 47.4502,
    longitude: -122.3088,
    timezone: "America/Los_Angeles",
    nwsOffice: "SEW",
    aliases: ["seattle", "seatac", "sea-tac", "ksea"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "atlanta-ga-katl",
    city: "Atlanta",
    state: "GA",
    stationId: "KATL",
    stationName: "Hartsfield-Jackson Atlanta International Airport",
    latitude: 33.6367,
    longitude: -84.4281,
    timezone: "America/New_York",
    nwsOffice: "FFC",
    aliases: ["atlanta", "hartsfield", "katl"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "washington-dc-kdca",
    city: "Washington",
    state: "DC",
    stationId: "KDCA",
    stationName: "Reagan National Airport",
    latitude: 38.8472,
    longitude: -77.0345,
    timezone: "America/New_York",
    nwsOffice: "LWX",
    aliases: ["washington", "washington dc", "dc ", "reagan", "kdca"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "dallas-tx-kdfw",
    city: "Dallas",
    state: "TX",
    stationId: "KDFW",
    stationName: "Dallas/Fort Worth International Airport",
    latitude: 32.8975,
    longitude: -97.0404,
    timezone: "America/Chicago",
    nwsOffice: "FWD",
    aliases: ["dallas", "fort worth", "dfw", "kdfw"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
  },
  {
    id: "houston-tx-kiah",
    city: "Houston",
    state: "TX",
    stationId: "KIAH",
    stationName: "Houston Intercontinental Airport",
    latitude: 29.9844,
    longitude: -95.3414,
    timezone: "America/Chicago",
    nwsOffice: "HGX",
    aliases: ["houston", "intercontinental", "kiah"],
    settlementSource: "nws_daily_climate_report",
    notes: "Candidate Kalshi weather station; confirm against market rules before live trading."
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
