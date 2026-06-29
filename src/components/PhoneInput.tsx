import { Input, Select } from "./ui";
import { getCountries, getCountryCallingCode, parsePhoneNumber, type CountryCode } from "libphonenumber-js";

// Country dropdown options: "Australia +61", sorted by country name.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const COUNTRIES = getCountries()
  .map((cc) => ({ cc, name: regionNames.of(cc) ?? cc, dial: getCountryCallingCode(cc) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function countryName(cc: CountryCode): string {
  return regionNames.of(cc) ?? cc;
}

// Returns the E.164 string if the national number is valid for the country,
// else null. libphonenumber enforces the correct length per country.
export function toE164(country: CountryCode, national: string): string | null {
  try {
    const pn = parsePhoneNumber(national, country);
    return pn && pn.isValid() ? pn.number : null;
  } catch {
    return null;
  }
}

export function PhoneInput({ country, national, onCountry, onNational }: {
  country: CountryCode; national: string;
  onCountry: (c: CountryCode) => void; onNational: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Select value={country} onChange={(e) => onCountry(e.target.value as CountryCode)} style={{ width: 150, flex: "none" }}>
        {COUNTRIES.map((co) => <option key={co.cc} value={co.cc}>{co.name} +{co.dial}</option>)}
      </Select>
      <Input value={national} onChange={(e) => onNational(e.target.value)} placeholder="Phone number" style={{ flex: 1 }} inputMode="tel" />
    </div>
  );
}
