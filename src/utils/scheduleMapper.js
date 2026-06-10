const svg = (name) =>
  `https://raw.githubusercontent.com/julesr0y/f1-circuits-svg/main/circuits/minimal/white/${name}.svg`

// FastF1 Location field → SVG filename
const TRACK_MAPS = {
  'Melbourne':        svg('melbourne-2'),
  'Shanghai':         svg('shanghai-1'),
  'Suzuka':           svg('suzuka-2'),
  'Sakhir':           svg('bahrain-1'),
  'Jeddah':           svg('jeddah-1'),
  'Miami':            svg('miami-1'),
  'Montreal':         svg('montreal-6'),
  'Monte-Carlo':      svg('monaco-6'),
  'Montmeló':         svg('catalunya-6'),
  'Spielberg':        svg('spielberg-3'),
  'Silverstone':      svg('silverstone-8'),
  'Spa-Francorchamps':svg('spa-francorchamps-4'),
  'Budapest':         svg('hungaroring-3'),
  'Zandvoort':        svg('zandvoort-5'),
  'Monza':            svg('monza-7'),
  'Baku':             svg('baku-1'),
  'Marina Bay':       svg('marina-bay-4'),
  'Austin':           svg('austin-1'),
  'Mexico City':      svg('mexico-city-3'),
  'São Paulo':        svg('interlagos-2'),
  'Las Vegas':        svg('las-vegas-1'),
  'Lusail':           svg('lusail-1'),
  'Abu Dhabi':        svg('yas-marina-2'),
  'Portimão':         svg('portimao-1'),
  'Imola':            svg('imola-4'),
  'Istanbul':         svg('istanbul-2'),
  'Mugello':          svg('mugello-1'),
  'Nürburg':          svg('nurburgring-4'),
  'Yas Marina':       svg('yas-marina-2'),
}

// Country name → ISO 3166-1 alpha-2 code (for flagcdn.com)
const COUNTRY_CODES = {
  'Australia':     'au',
  'China':         'cn',
  'Japan':         'jp',
  'Bahrain':       'bh',
  'Saudi Arabia':  'sa',
  'USA':           'us',
  'United States': 'us',
  'Canada':        'ca',
  'Monaco':        'mc',
  'Spain':         'es',
  'Austria':       'at',
  'United Kingdom':'gb',
  'Belgium':       'be',
  'Hungary':       'hu',
  'Netherlands':   'nl',
  'Italy':         'it',
  'Azerbaijan':    'az',
  'Singapore':     'sg',
  'Mexico':        'mx',
  'Brazil':        'br',
  'Qatar':         'qa',
  'UAE':           'ae',
  'United Arab Emirates': 'ae',
  'Portugal':      'pt',
  'Turkey':        'tr',
  'Germany':       'de',
  'France':        'fr',
  'Russia':        'ru',
  'Vietnam':       'vn',
}

export function mapScheduleToRaces(events) {
  const today = new Date()
  return events.map((e) => {
    const raceDate       = new Date(e.EventDate)
    const firstSessDate  = e.Session1Date ? new Date(e.Session1Date) : null
    const status =
      raceDate  < today ? 'completed'   :
      firstSessDate && firstSessDate < today ? 'in_progress' :
      'upcoming'
    return {
      round:            e.RoundNumber,
      name:             e.EventName,
      circuit:          e.Location,
      country:          e.Country,
      countryCode:      COUNTRY_CODES[e.Country] ?? 'un',
      trackMap:         TRACK_MAPS[e.Location] ?? null,
      date:             e.EventDate.split('T')[0],
      firstSessionDate: e.Session1Date ? e.Session1Date.split('T')[0] : null,
      status,
    }
  })
}
