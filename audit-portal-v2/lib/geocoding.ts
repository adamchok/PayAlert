export interface GeoPoint {
  lat: number
  lng: number
  label: string
}

const CITY_COORDS: Record<string, GeoPoint> = {
  // Malaysia — major cities
  'kuala lumpur':   { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' },
  'kl':             { lat: 3.1390, lng: 101.6869, label: 'Kuala Lumpur' },
  'petaling jaya':  { lat: 3.1073, lng: 101.6067, label: 'Petaling Jaya' },
  'subang jaya':    { lat: 3.0497, lng: 101.5798, label: 'Subang Jaya' },
  'shah alam':      { lat: 3.0738, lng: 101.5183, label: 'Shah Alam' },
  'klang':          { lat: 3.0449, lng: 101.4468, label: 'Klang' },
  'penang':         { lat: 5.4141, lng: 100.3288, label: 'Penang' },
  'george town':    { lat: 5.4141, lng: 100.3288, label: 'George Town' },
  'johor bahru':    { lat: 1.4927, lng: 103.7414, label: 'Johor Bahru' },
  'jb':             { lat: 1.4927, lng: 103.7414, label: 'Johor Bahru' },
  'ipoh':           { lat: 4.5975, lng: 101.0901, label: 'Ipoh' },
  'kota kinabalu':  { lat: 5.9788, lng: 116.0753, label: 'Kota Kinabalu' },
  'kuching':        { lat: 1.5533, lng: 110.3592, label: 'Kuching' },
  'melaka':         { lat: 2.1896, lng: 102.2501, label: 'Melaka' },
  'malacca':        { lat: 2.1896, lng: 102.2501, label: 'Melaka' },
  'seremban':       { lat: 2.7297, lng: 101.9381, label: 'Seremban' },
  'alor setar':     { lat: 6.1248, lng: 100.3678, label: 'Alor Setar' },
  'kuala terengganu': { lat: 5.3296, lng: 103.1370, label: 'Kuala Terengganu' },
  'kota bharu':     { lat: 6.1254, lng: 102.2381, label: 'Kota Bharu' },
  'kuantan':        { lat: 3.8077, lng: 103.3260, label: 'Kuantan' },
  'miri':           { lat: 4.3995, lng: 113.9914, label: 'Miri' },
  'sandakan':       { lat: 5.8456, lng: 118.1180, label: 'Sandakan' },
  'putrajaya':      { lat: 2.9264, lng: 101.6964, label: 'Putrajaya' },
  'cyberjaya':      { lat: 2.9213, lng: 101.6559, label: 'Cyberjaya' },
  'puchong':        { lat: 3.0273, lng: 101.6197, label: 'Puchong' },
  'ampang':         { lat: 3.1489, lng: 101.7500, label: 'Ampang' },
  'cheras':         { lat: 3.0833, lng: 101.7333, label: 'Cheras' },
  'kajang':         { lat: 2.9935, lng: 101.7872, label: 'Kajang' },
  'sepang':         { lat: 2.7222, lng: 101.7167, label: 'Sepang' },
}

const COUNTRY_COORDS: Record<string, GeoPoint> = {
  'malaysia':       { lat: 4.2105, lng: 101.9758, label: 'Malaysia' },
  'my':             { lat: 4.2105, lng: 101.9758, label: 'Malaysia' },
  'mys':            { lat: 4.2105, lng: 101.9758, label: 'Malaysia' },
  'singapore':      { lat: 1.3521, lng: 103.8198, label: 'Singapore' },
  'sg':             { lat: 1.3521, lng: 103.8198, label: 'Singapore' },
  'sgp':            { lat: 1.3521, lng: 103.8198, label: 'Singapore' },
  'thailand':       { lat: 15.8700, lng: 100.9925, label: 'Thailand' },
  'th':             { lat: 15.8700, lng: 100.9925, label: 'Thailand' },
  'tha':            { lat: 15.8700, lng: 100.9925, label: 'Thailand' },
  'indonesia':      { lat: -0.7893, lng: 113.9213, label: 'Indonesia' },
  'id':             { lat: -0.7893, lng: 113.9213, label: 'Indonesia' },
  'idn':            { lat: -0.7893, lng: 113.9213, label: 'Indonesia' },
  'philippines':    { lat: 12.8797, lng: 121.7740, label: 'Philippines' },
  'ph':             { lat: 12.8797, lng: 121.7740, label: 'Philippines' },
  'phl':            { lat: 12.8797, lng: 121.7740, label: 'Philippines' },
  'vietnam':        { lat: 14.0583, lng: 108.2772, label: 'Vietnam' },
  'vn':             { lat: 14.0583, lng: 108.2772, label: 'Vietnam' },
  'vnm':            { lat: 14.0583, lng: 108.2772, label: 'Vietnam' },
  'china':          { lat: 35.8617, lng: 104.1954, label: 'China' },
  'cn':             { lat: 35.8617, lng: 104.1954, label: 'China' },
  'chn':            { lat: 35.8617, lng: 104.1954, label: 'China' },
  'japan':          { lat: 36.2048, lng: 138.2529, label: 'Japan' },
  'jp':             { lat: 36.2048, lng: 138.2529, label: 'Japan' },
  'jpn':            { lat: 36.2048, lng: 138.2529, label: 'Japan' },
  'south korea':    { lat: 35.9078, lng: 127.7669, label: 'South Korea' },
  'kr':             { lat: 35.9078, lng: 127.7669, label: 'South Korea' },
  'kor':            { lat: 35.9078, lng: 127.7669, label: 'South Korea' },
  'united states':  { lat: 37.0902, lng: -95.7129, label: 'United States' },
  'us':             { lat: 37.0902, lng: -95.7129, label: 'United States' },
  'usa':            { lat: 37.0902, lng: -95.7129, label: 'United States' },
  'united kingdom': { lat: 55.3781, lng: -3.4360, label: 'United Kingdom' },
  'uk':             { lat: 55.3781, lng: -3.4360, label: 'United Kingdom' },
  'gbr':            { lat: 55.3781, lng: -3.4360, label: 'United Kingdom' },
  'australia':      { lat: -25.2744, lng: 133.7751, label: 'Australia' },
  'au':             { lat: -25.2744, lng: 133.7751, label: 'Australia' },
  'aus':            { lat: -25.2744, lng: 133.7751, label: 'Australia' },
  'hong kong':      { lat: 22.3193, lng: 114.1694, label: 'Hong Kong' },
  'hk':             { lat: 22.3193, lng: 114.1694, label: 'Hong Kong' },
  'hkg':            { lat: 22.3193, lng: 114.1694, label: 'Hong Kong' },
  'india':          { lat: 20.5937, lng: 78.9629, label: 'India' },
  'in':             { lat: 20.5937, lng: 78.9629, label: 'India' },
  'ind':            { lat: 20.5937, lng: 78.9629, label: 'India' },
}

export function geocodeLocation(city?: string, country?: string): GeoPoint | null {
  if (city) {
    const cityKey = city.toLowerCase().trim()
    if (CITY_COORDS[cityKey]) return CITY_COORDS[cityKey]
  }
  if (country) {
    const countryKey = country.toLowerCase().trim()
    if (COUNTRY_COORDS[countryKey]) return COUNTRY_COORDS[countryKey]
  }
  return null
}
