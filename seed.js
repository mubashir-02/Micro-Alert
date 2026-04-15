require('dotenv').config();
const mongoose = require('mongoose');
const Risk = require('./models/Risk');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/micro-alert';

const seedData = [
  // ── Sudden Braking Zones ─────────────────────────────────────────────────────
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2121, 13.0123] },
    severity: 5,
    description: 'Severe sudden braking zone at Kathipara Junction during evening rush due to converging flyover traffic from 3 directions. Vehicles descending the flyover frequently brake hard when merging.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Kathipara Junction',
    landmark: 'Kathipara Flyover',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2552, 13.0628] },
    severity: 4,
    description: 'Sudden braking near Gemini Circle at 6 PM due to merging traffic from Anna Salai and Cathedral Road. Signal changes cause chain-reaction braking.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Anna Salai',
    landmark: 'Gemini Circle',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2279, 12.9012] },
    severity: 4,
    description: 'Sudden braking near Sholinganallur signal during rains. Water logging causes vehicles to brake abruptly. Visibility reduced in heavy rain.',
    timeOfDay: 'morning_rush',
    weather: 'rain',
    roadName: 'Rajiv Gandhi Salai (OMR)',
    landmark: 'Sholinganallur Signal',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2396, 13.0475] },
    severity: 3,
    description: 'Sudden braking at Teynampet signal as pedestrians cross during green signal. Auto-rickshaws stop abruptly to pick passengers.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Anna Salai',
    landmark: 'Teynampet Junction',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2707, 13.0827] },
    severity: 4,
    description: 'Sudden braking at Chennai Central approach road. High bus and auto traffic causes erratic stopping. Especially dangerous during morning rush.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'Poonamallee High Road',
    landmark: 'Chennai Central Railway Station',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2340, 13.0475] },
    severity: 3,
    description: 'Frequent chain-braking near Panagal Park due to MTC buses stopping without warning at unmarked bus stops.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'South Usman Road',
    landmark: 'Panagal Park',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2575, 13.0043] },
    severity: 4,
    description: 'Abrupt braking on Adyar Bridge approach. Narrow lanes and merging traffic from Lattice Bridge Road cause sudden stops.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Sardar Patel Road',
    landmark: 'Adyar Bridge',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2185, 13.0604] },
    severity: 3,
    description: 'Braking zone near Vadapalani signal. Temple visitors jaywalking and heavy auto-rickshaw traffic cause abrupt stops.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Arcot Road',
    landmark: 'Vadapalani Temple',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.1445, 12.9249] },
    severity: 4,
    description: 'Sharp braking at Tambaram level crossing when railway gates close without sufficient warning. Long queues form quickly.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'GST Road',
    landmark: 'Tambaram Railway Crossing',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2329, 12.9907] },
    severity: 3,
    description: 'Sudden braking near Guindy Industrial Estate entrance due to trucks making slow turns into factory gates.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'Mount Poonamallee Road',
    landmark: 'Guindy Industrial Estate',
    verified: true
  },

  // ── Blind Turns ──────────────────────────────────────────────────────────────
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2463, 12.8256] },
    severity: 4,
    description: 'Dangerous blind turn on ECR near Muttukadu. Overgrown vegetation blocks line of sight. Multiple near-miss incidents reported on weekends.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'East Coast Road (ECR)',
    landmark: 'Muttukadu Boat House',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2707, 13.0627] },
    severity: 5,
    description: 'Blind turn on Mount Road near LIC building. Tall compound wall blocks visibility completely. Two-wheelers cutting across lanes at high speed.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Anna Salai (Mount Road)',
    landmark: 'LIC Building',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2647, 13.0447] },
    severity: 4,
    description: 'Blind curve on Dr. Radhakrishnan Salai near the lighthouse. Parked cars reduce visibility. Cyclists and pedestrians appear unexpectedly around the bend.',
    timeOfDay: 'morning_rush',
    weather: 'fog',
    roadName: 'Dr. Radhakrishnan Salai',
    landmark: 'Chennai Lighthouse',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2497, 13.0336] },
    severity: 3,
    description: 'Sharp blind turn at the Alwarpet Canal Bridge. Narrow road width and parked vehicles create dangerous blind spot.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'C.P. Ramaswamy Road',
    landmark: 'Alwarpet Canal Bridge',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2154, 13.0858] },
    severity: 4,
    description: 'Blind turn at Anna Nagar 2nd Avenue and 18th Main Road intersection. Large banyan tree completely blocks left-turn visibility.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: '2nd Avenue, Anna Nagar',
    landmark: 'Anna Nagar Tower Park',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.1927, 13.0471] },
    severity: 3,
    description: 'Hidden curve on Porur bypass road behind a construction barricade. Unmarked and poorly lit at night.',
    timeOfDay: 'night',
    weather: 'clear',
    roadName: 'Porur Bypass Road',
    landmark: 'Porur Junction',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2396, 13.1098] },
    severity: 3,
    description: 'Blind entry from L&T service road merging onto Poonamallee High Road. No mirror or warning signs installed.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Poonamallee High Road',
    landmark: 'L&T Flyover',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2609, 12.9735] },
    severity: 4,
    description: 'Dangerous S-curve near Thiruvanmiyur MRTS station. Vehicles exiting the parking lot are invisible to through traffic.',
    timeOfDay: 'evening_rush',
    weather: 'rain',
    roadName: 'Rajiv Gandhi Salai (OMR)',
    landmark: 'Thiruvanmiyur MRTS Station',
    verified: true
  },

  // ── Habitual Violations ──────────────────────────────────────────────────────
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2628, 13.0654] },
    severity: 3,
    description: 'Chronic jaywalking near Spencer Plaza. Pedestrians cross Anna Salai at all points ignoring the foot overbridge. Extremely dangerous during peak hours.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Anna Salai',
    landmark: 'Spencer Plaza',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2775, 13.0569] },
    severity: 4,
    description: 'Consistent wrong-way driving on Marina Beach Road one-way during early morning hours. Two-wheelers and autos frequently violate.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'Kamarajar Salai',
    landmark: 'Marina Beach Promenade',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2341, 13.0417] },
    severity: 3,
    description: 'Red-light running at T. Nagar Pondy Bazaar junction. Two-wheelers routinely jump signal, especially during late evening hours.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Pondy Bazaar',
    landmark: 'T. Nagar Bus Terminus',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2224, 13.0095] },
    severity: 4,
    description: 'Illegal U-turns at Guindy National Park entrance. Vehicles from Kathipara side make unsafe U-turns despite "No U-turn" sign.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Sardar Patel Road',
    landmark: 'Guindy National Park',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2089, 13.0743] },
    severity: 2,
    description: 'Habitual triple-riding on two-wheelers near Koyambedu Bus Terminus. Families with children riding without helmets.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Jawaharlal Nehru Road',
    landmark: 'Koyambedu Bus Terminus',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2489, 13.0601] },
    severity: 3,
    description: 'Persistent footpath parking on Nungambakkam High Road forces pedestrians to walk on the main road into traffic.',
    timeOfDay: 'afternoon',
    weather: 'clear',
    roadName: 'Nungambakkam High Road',
    landmark: 'Nungambakkam Railway Station',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2573, 13.0868] },
    severity: 4,
    description: 'Dangerous overloaded share-autos near Flower Bazaar. Vehicles carry 12+ passengers and drive erratically through congested streets.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'NSC Bose Road',
    landmark: 'Flower Bazaar',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2204, 12.9485] },
    severity: 3,
    description: 'Chronic wrong-side driving on Velachery Main Road near Phoenix Mall. Two-wheelers use opposite lane to avoid traffic.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Velachery Main Road',
    landmark: 'Phoenix MarketCity',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2428, 13.0734] },
    severity: 3,
    description: 'Bus lane violations on Anna Salai near Egmore. Cars and autos use dedicated bus lane, causing MTC buses to brake suddenly.',
    timeOfDay: 'morning_rush',
    weather: 'clear',
    roadName: 'Anna Salai',
    landmark: 'Egmore Museum',
    verified: true
  },
  {
    type: 'sudden_brake',
    location: { type: 'Point', coordinates: [80.2504, 13.0472] },
    severity: 3,
    description: 'Sudden braking at Thousand Lights intersection due to auto-rickshaws cutting across from the mosque side.',
    timeOfDay: 'evening_rush',
    weather: 'clear',
    roadName: 'Anna Salai',
    landmark: 'Thousand Lights Mosque',
    verified: true
  },
  {
    type: 'blind_turn',
    location: { type: 'Point', coordinates: [80.2270, 12.8690] },
    severity: 3,
    description: 'Obscured turn on Kelambakkam Road. Construction debris narrows the road and blocks view around the bend.',
    timeOfDay: 'night',
    weather: 'clear',
    roadName: 'Kelambakkam Road',
    landmark: 'Near SRM University',
    verified: true
  },
  {
    type: 'habitual_violation',
    location: { type: 'Point', coordinates: [80.2093, 13.0476] },
    severity: 4,
    description: 'Speed limit violations on inner ring road near Ashok Nagar. Vehicles routinely exceed 80 km/h in a 40 km/h zone.',
    timeOfDay: 'night',
    weather: 'clear',
    roadName: 'Inner Ring Road',
    landmark: 'Ashok Nagar',
    verified: true
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    await Risk.deleteMany({});
    console.log('🗑️  Cleared existing risks');

    const inserted = await Risk.insertMany(seedData);
    console.log(`🌱 Seeded ${inserted.length} micro-risk events across Chennai`);

    // Ensure geospatial index
    await Risk.collection.createIndex({ location: '2dsphere' });
    console.log('📍 Geospatial index created');

    await mongoose.disconnect();
    console.log('✅ Done. Run "npm start" to launch the app.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
  }
}

seed();
