import { load } from 'cheerio';

export type ClubContactRow = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
};

const PRIVATE_PLACEHOLDER = 'private - log on to website';

const isPrivate = (value: string): boolean =>
  value.toLowerCase().includes(PRIVATE_PLACEHOLDER);

export const parseClubContacts = (html: string): ClubContactRow[] => {
  const $ = load(html);
  const rows: ClubContactRow[] = [];

  $('table.wizardWebObject_table').each((_, table) => {
    let name = '';
    let role: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;

    $(table)
      .find('tr')
      .each((_, tr) => {
        const label = $(tr).find('td b i').text().trim().replace(/:$/, '');
        const cells = $(tr).find('td');
        // Layout: [empty, label-cell, value-cell, (optional empty)]
        const valueCell = cells.eq(2);
        const rawValue = valueCell.text().trim();

        if (label === 'Name') {
          name = rawValue;
        } else if (label === 'Role') {
          role = rawValue.length > 0 ? rawValue : undefined;
        } else if (label === 'Telephone') {
          if (!isPrivate(rawValue) && rawValue.length > 0) {
            phone = rawValue;
          }
        } else if (label === 'Email') {
          if (!isPrivate(rawValue) && rawValue.length > 0) {
            email = rawValue;
          }
        }
      });

    if (name.length > 0) {
      const row: ClubContactRow = { name };
      if (role !== undefined) row.role = role;
      if (phone !== undefined) row.phone = phone;
      if (email !== undefined) row.email = email;
      rows.push(row);
    }
  });

  return rows;
};
