import { load } from 'cheerio';

export type ClubLocationRow = {
  address?: string;
  postcode?: string;
  lat?: number;
  lng?: number;
};

const POSTCODE_RE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i;
const COORDS_RE = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;

export const parseClubLocation = (html: string): ClubLocationRow => {
  const $ = load(html);

  // Scope to the address form container, exclude the contacts table and map divs
  // so base64 image data never enters our text extraction path.
  const container = $('#wizardWebObject_form');

  // Remove the contacts sub-section (position:absolute div containing the table)
  container.find('table.wizardWebObject_table').closest('div[style*="position: absolute"]').remove();

  // Remove any element whose text contains a base64 data URI (safety net)
  container.find('[style*="data:image"]').remove();

  // Collect text from remaining divs (skip the spacer divs that are height-only)
  const textDivs: string[] = [];
  container.find('div').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0) {
      textDivs.push(text);
    }
  });

  // The address div is the one containing the postcode.
  // We identify it by finding the div whose text matches the postcode pattern.
  let addressText: string | undefined;
  let postcode: string | undefined;

  for (const text of textDivs) {
    const match = POSTCODE_RE.exec(text);
    if (match?.[1] !== undefined) {
      addressText = text;
      postcode = match[1].replace(/\s+/g, ' ').toUpperCase();
      break;
    }
  }

  // Normalise address: collapse whitespace.
  let address: string | undefined;
  if (addressText !== undefined) {
    address = addressText.replace(/\s+/g, ' ').trim();
  }

  // Extract lat/lng if present in a map iframe src or script text
  let lat: number | undefined;
  let lng: number | undefined;

  const scriptText = $('script').text();
  const coordMatch = COORDS_RE.exec(scriptText);
  if (coordMatch?.[1] !== undefined && coordMatch[2] !== undefined) {
    const mayLat = parseFloat(coordMatch[1]);
    const mayLng = parseFloat(coordMatch[2]);
    if (mayLat >= -90 && mayLat <= 90 && mayLng >= -180 && mayLng <= 180) {
      lat = mayLat;
      lng = mayLng;
    }
  }

  const row: ClubLocationRow = {};
  if (address !== undefined) row.address = address;
  if (postcode !== undefined) row.postcode = postcode;
  if (lat !== undefined) row.lat = lat;
  if (lng !== undefined) row.lng = lng;
  return row;
};
