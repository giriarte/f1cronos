export const SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020]

const svg = (name) => `https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/main/circuits/minimal/white/${name}.svg`

export const RACES_BY_SEASON = {
  2026: [
    { round: 1,  name: 'Australian Grand Prix',   circuit: 'Albert Park',                  country: 'Australia',    countryCode: 'au', trackMap: svg('melbourne-2'),        date: '2026-03-08', status: 'completed' },
    { round: 2,  name: 'Chinese Grand Prix',       circuit: 'Shanghai International',       country: 'China',        countryCode: 'cn', trackMap: svg('shanghai-1'),         date: '2026-03-15', status: 'completed' },
    { round: 3,  name: 'Japanese Grand Prix',      circuit: 'Suzuka',                       country: 'Japan',        countryCode: 'jp', trackMap: svg('suzuka-2'),           date: '2026-03-29', status: 'completed' },
    { round: 4,  name: 'Bahrain Grand Prix',       circuit: 'Bahrain International',        country: 'Bahrain',      countryCode: 'bh', trackMap: svg('bahrain-1'),          date: '2026-04-12', status: 'cancelled' },
    { round: 5,  name: 'Saudi Arabian Grand Prix', circuit: 'Jeddah Corniche',              country: 'Saudi Arabia', countryCode: 'sa', trackMap: svg('jeddah-1'),           date: '2026-04-19', status: 'cancelled' },
    { round: 6,  name: 'Miami Grand Prix',         circuit: 'Miami International',          country: 'USA',          countryCode: 'us', trackMap: svg('miami-1'),            date: '2026-05-03', status: 'completed' },
    { round: 7,  name: 'Canadian Grand Prix',      circuit: 'Circuit Gilles Villeneuve',    country: 'Canada',       countryCode: 'ca', trackMap: svg('montreal-6'),         date: '2026-05-24', status: 'upcoming' },
    { round: 8,  name: 'Monaco Grand Prix',        circuit: 'Circuit de Monaco',            country: 'Monaco',       countryCode: 'mc', trackMap: svg('monaco-6'),           date: '2026-06-07', status: 'upcoming' },
    { round: 9,  name: 'Spanish Grand Prix',       circuit: 'Circuit de Barcelona',         country: 'Spain',        countryCode: 'es', trackMap: svg('catalunya-6'),        date: '2026-06-14', status: 'upcoming' },
    { round: 10, name: 'Austrian Grand Prix',      circuit: 'Red Bull Ring',                country: 'Austria',      countryCode: 'at', trackMap: svg('spielberg-3'),        date: '2026-06-28', status: 'upcoming' },
    { round: 11, name: 'British Grand Prix',       circuit: 'Silverstone',                  country: 'UK',           countryCode: 'gb', trackMap: svg('silverstone-8'),      date: '2026-07-05', status: 'upcoming' },
    { round: 12, name: 'Belgian Grand Prix',       circuit: 'Spa-Francorchamps',            country: 'Belgium',      countryCode: 'be', trackMap: svg('spa-francorchamps-4'),date: '2026-07-19', status: 'upcoming' },
    { round: 13, name: 'Hungarian Grand Prix',     circuit: 'Hungaroring',                  country: 'Hungary',      countryCode: 'hu', trackMap: svg('hungaroring-3'),      date: '2026-07-26', status: 'upcoming' },
    { round: 14, name: 'Dutch Grand Prix',         circuit: 'Zandvoort',                    country: 'Netherlands',  countryCode: 'nl', trackMap: svg('zandvoort-5'),        date: '2026-08-23', status: 'upcoming' },
    { round: 15, name: 'Italian Grand Prix',       circuit: 'Monza',                        country: 'Italy',        countryCode: 'it', trackMap: svg('monza-7'),            date: '2026-09-06', status: 'upcoming' },
    { round: 16, name: 'Madrid Grand Prix',        circuit: 'Madring',                      country: 'Spain',        countryCode: 'es', trackMap: svg('madring-1'),          date: '2026-09-13', status: 'upcoming' },
    { round: 17, name: 'Azerbaijan Grand Prix',    circuit: 'Baku City Circuit',            country: 'Azerbaijan',   countryCode: 'az', trackMap: svg('baku-1'),             date: '2026-09-26', status: 'upcoming' },
    { round: 18, name: 'Singapore Grand Prix',     circuit: 'Marina Bay Street',            country: 'Singapore',    countryCode: 'sg', trackMap: svg('marina-bay-4'),       date: '2026-10-11', status: 'upcoming' },
    { round: 19, name: 'United States Grand Prix', circuit: 'Circuit of the Americas',      country: 'USA',          countryCode: 'us', trackMap: svg('austin-1'),           date: '2026-10-25', status: 'upcoming' },
    { round: 20, name: 'Mexico City Grand Prix',   circuit: 'Autodromo Hermanos Rodriguez', country: 'Mexico',       countryCode: 'mx', trackMap: svg('mexico-city-3'),      date: '2026-11-01', status: 'upcoming' },
    { round: 21, name: 'São Paulo Grand Prix',     circuit: 'Interlagos',                   country: 'Brazil',       countryCode: 'br', trackMap: svg('interlagos-2'),       date: '2026-11-08', status: 'upcoming' },
    { round: 22, name: 'Las Vegas Grand Prix',     circuit: 'Las Vegas Strip',              country: 'USA',          countryCode: 'us', trackMap: svg('las-vegas-1'),        date: '2026-11-21', status: 'upcoming' },
    { round: 23, name: 'Qatar Grand Prix',         circuit: 'Lusail International',         country: 'Qatar',        countryCode: 'qa', trackMap: svg('lusail-1'),           date: '2026-11-29', status: 'upcoming' },
    { round: 24, name: 'Abu Dhabi Grand Prix',     circuit: 'Yas Marina',                   country: 'UAE',          countryCode: 'ae', trackMap: svg('yas-marina-2'),       date: '2026-12-06', status: 'upcoming' },
  ],
}
