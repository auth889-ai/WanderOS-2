/** Country essentials — a reliable static map (currency · language · capital · driving side · timezone). */
export type CountryFacts = { currencyCode: string; currencyName: string; currencySymbol: string; languages: string[]; capital: string; drivingSide: string; timezone: string };

const FACTS: Record<string, CountryFacts> = {
  BD: { currencyCode: "BDT", currencyName: "Bangladeshi Taka", currencySymbol: "৳", languages: ["Bengali"], capital: "Dhaka", drivingSide: "left", timezone: "UTC+06:00" },
  IN: { currencyCode: "INR", currencyName: "Indian Rupee", currencySymbol: "₹", languages: ["Hindi", "English"], capital: "New Delhi", drivingSide: "left", timezone: "UTC+05:30" },
  PK: { currencyCode: "PKR", currencyName: "Pakistani Rupee", currencySymbol: "₨", languages: ["Urdu", "English"], capital: "Islamabad", drivingSide: "left", timezone: "UTC+05:00" },
  LK: { currencyCode: "LKR", currencyName: "Sri Lankan Rupee", currencySymbol: "Rs", languages: ["Sinhala", "Tamil"], capital: "Colombo", drivingSide: "left", timezone: "UTC+05:30" },
  NP: { currencyCode: "NPR", currencyName: "Nepalese Rupee", currencySymbol: "₨", languages: ["Nepali"], capital: "Kathmandu", drivingSide: "left", timezone: "UTC+05:45" },
  TH: { currencyCode: "THB", currencyName: "Thai Baht", currencySymbol: "฿", languages: ["Thai"], capital: "Bangkok", drivingSide: "left", timezone: "UTC+07:00" },
  JP: { currencyCode: "JPY", currencyName: "Japanese Yen", currencySymbol: "¥", languages: ["Japanese"], capital: "Tokyo", drivingSide: "left", timezone: "UTC+09:00" },
  AE: { currencyCode: "AED", currencyName: "UAE Dirham", currencySymbol: "د.إ", languages: ["Arabic", "English"], capital: "Abu Dhabi", drivingSide: "right", timezone: "UTC+04:00" },
  MY: { currencyCode: "MYR", currencyName: "Malaysian Ringgit", currencySymbol: "RM", languages: ["Malay", "English"], capital: "Kuala Lumpur", drivingSide: "left", timezone: "UTC+08:00" },
  ID: { currencyCode: "IDR", currencyName: "Indonesian Rupiah", currencySymbol: "Rp", languages: ["Indonesian"], capital: "Jakarta", drivingSide: "left", timezone: "UTC+07:00" },
  SG: { currencyCode: "SGD", currencyName: "Singapore Dollar", currencySymbol: "S$", languages: ["English", "Malay"], capital: "Singapore", drivingSide: "left", timezone: "UTC+08:00" },
  US: { currencyCode: "USD", currencyName: "US Dollar", currencySymbol: "$", languages: ["English"], capital: "Washington, D.C.", drivingSide: "right", timezone: "UTC−05:00" },
  GB: { currencyCode: "GBP", currencyName: "Pound Sterling", currencySymbol: "£", languages: ["English"], capital: "London", drivingSide: "left", timezone: "UTC+00:00" },
  FR: { currencyCode: "EUR", currencyName: "Euro", currencySymbol: "€", languages: ["French"], capital: "Paris", drivingSide: "right", timezone: "UTC+01:00" },
  IT: { currencyCode: "EUR", currencyName: "Euro", currencySymbol: "€", languages: ["Italian"], capital: "Rome", drivingSide: "right", timezone: "UTC+01:00" },
  ES: { currencyCode: "EUR", currencyName: "Euro", currencySymbol: "€", languages: ["Spanish"], capital: "Madrid", drivingSide: "right", timezone: "UTC+01:00" },
  TR: { currencyCode: "TRY", currencyName: "Turkish Lira", currencySymbol: "₺", languages: ["Turkish"], capital: "Ankara", drivingSide: "right", timezone: "UTC+03:00" },
  MV: { currencyCode: "MVR", currencyName: "Maldivian Rufiyaa", currencySymbol: "Rf", languages: ["Dhivehi"], capital: "Malé", drivingSide: "left", timezone: "UTC+05:00" },
  BT: { currencyCode: "BTN", currencyName: "Bhutanese Ngultrum", currencySymbol: "Nu", languages: ["Dzongkha"], capital: "Thimphu", drivingSide: "left", timezone: "UTC+06:00" }
};

export function getCountryFacts(code: string): CountryFacts | null {
  return FACTS[(code || "").toUpperCase()] ?? null;
}
