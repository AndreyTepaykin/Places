# Places Plugin — LLM Coding Primer

Supplement to the Q Framework, Users, and Streams primers. Covers geolocation,
the nearby grid, venue hierarchy, IP lookup, and geographic reference data.
Read before writing Places-related code.

---

## 1. Nearby Grid — Publishing & Subscribing

```php
// PUBLISHING: relate content to all nearby category streams
$publisherId = Users::communityId();
$latitude = 40.7128;
$longitude = -74.0060;

// Get category streams to relate to (one per distance tier)
$nearby = Places_Nearby::forPublishers($latitude, $longitude);
// Returns array: streamName => {latitude, longitude, geohash, meters}
// Stream name format: "Places/nearby/main/{geohash}/{meters}"

// Relate your content stream to all nearby categories
foreach ($nearby as $streamName => $info) {
    Streams::relate(null, $publisherId, $streamName,
        'MyPlugin/events', $fromPublisherId, $fromStreamName,
        array('skipAccess' => true, 'weight' => time())
    );
}

// Or use the streams() helper to auto-create category streams + relate
$streams = Places_Nearby::streams($publisherId, $latitude, $longitude, array(
    'meters' => null  // null = use all tiers from config
));

// SUBSCRIBING: join/subscribe to the 2x2 grid block at one distance tier
// $meters MUST be one of the values in Places/nearby/meters config
Places_Nearby::subscribe($publisherId, $latitude, $longitude, $meters);
Places_Nearby::unsubscribe($publisherId, $latitude, $longitude, $meters);

// Or just join (no notifications)
Places_Nearby::join($publisherId, $latitude, $longitude, $meters);
```

**Grid mechanics:** Publishers snap to one cell per tier. Subscribers join a 2×2 block anchored at the nearest grid corner. This guarantees the subscriber's circle of radius `$meters` is always fully covered.

---

## 2. Querying Nearby Content

```php
// Fetch relations to nearby streams for a location + time window
$relations = Places_Nearby::byTime(
    $publisherId,
    'MyPlugin/events',         // relation type
    $fromTimestamp,             // unix timestamp
    $toTimestamp,               // unix timestamp
    'Streams/experience/main', // fallback if no lat/lon
    array(
        'latitude' => $latitude,
        'longitude' => $longitude,
        'meters' => $meters
    )
);
// Returns array of Streams_RelatedTo objects

// Fetch relations directly from nearby streams
$relations = Places_Nearby::related(
    $publisherId,
    'MyPlugin/events',
    $latitude, $longitude, $meters
);
// Returns Streams_RelatedTo rows sorted by ascending weight.
// NOTE: Some results may be slightly out of range — filter with:
$dist = Places::distance($lat1, $lon1, $lat2, $lon2);  // meters
if ($dist <= $maxMeters) { /* in range */ }

// Geohash range query (alternative to grid system)
$range = Places_Nearby::geohashRange($latitude, $longitude, $meters);
// Returns Db_Range for prefix queries:
$rows = MyPlugin_Thing::select('*')
    ->where(array('geohash' => $range))
    ->fetchDbRows();
```

---

## 3. User Location

```php
// Get logged-in user's location stream
$stream = Places_Location::userStream();  // null if not logged in
$stream = Places_Location::userStream(true);  // throws if not logged in

// Read location attributes
$lat = $stream->getAttribute('latitude');
$lng = $stream->getAttribute('longitude');
$tz  = $stream->getAttribute('timezone');
$pc  = $stream->getAttribute('postcode');
$m   = $stream->getAttribute('meters');

// Update user location programmatically
Places_Location::changed(array(
    'user'      => $user,
    'latitude'  => 40.7128,
    'longitude' => -74.0060,
    'meters'    => 50000,
    'source'    => 'geolocation',   // or 'ip'
    'timezone'  => -5,
    // Flags:
    'joinNearby'     => 0,   // 0=no, 1=join, 2=join+subscribe
    'leaveNearby'    => 0,
    'joinInterests'  => 0,
    'leaveInterests' => 0
));
// Saves to Places/user/location stream, posts Places/location/updated message

// Set user location from any stream with lat/lon attributes
Places::setUserLocation($locationStream, $onlyIfNotSet);

// Get defaults (from user stream or config fallback)
list($latitude, $longitude, $meters) = Places_Nearby::defaults();
```

User location streams (auto-created):

| Stream Name | Purpose |
|---|---|
| `Places/user/location` | Current location (geolocation or IP) |
| `Places/user/location/ip` | Last IP-based location |
| `Places/user/location/home` | Home address |
| `Places/user/location/work` | Work address |
| `Places/user/locations` | Category of saved locations |

---

## 4. Venue Hierarchy (Location → Area → Floor/Column)

```php
// Create or fetch a location stream from Google Places placeId
$location = Places_Location::stream($asUserId, $publisherId, $placeId, array(
    'withTimeZone' => true
));
// Attributes: latitude, longitude, viewport, address, phoneNumber,
//             types, rating, website, placeId, timeZone

// Add an area within a location
list($area, $floor, $column) = Places_Location::addArea(
    $location,        // parent location stream
    'VIP Section',    // area title
    '2',              // floor number (optional)
    'A'               // column name (optional)
);
// Creates Places/area/{placeId}/{normalizedName} stream
// Relates to location via 'Places/areas'
// Optionally creates Places/floor/{placeId}/2 and Places/column/{placeId}/a

// Read location from a stream's attributes
$loc = Places_Location::fromStream($stream);
// Returns array: ['latitude' => ..., 'longitude' => ..., ...]
```

Stream types and their relations:
```
Places/location
  └── Places/areas → Places/area
        ├── Places/floor → Places/floor
        └── Places/column → Places/column
              └── (can contain Places/table)
```

---

## 5. Autocomplete & Google Places

```php
// Autocomplete (cached, uses Google Places API)
$predictions = Places::autocomplete(
    'starbucks near times square',
    false,                          // throwIfBadValue
    array('establishment'),         // types (or true for all)
    40.7580, -73.9855,              // search center (null = user location)
    40234                           // radius in meters
);
// Returns array of Google prediction objects
// Supported types: establishment, locality, sublocality, postal_code,
//   country, administrative_area_level_1, administrative_area_level_2

// Get timezone for coordinates
$tz = Places::timezone($latitude, $longitude);
// Returns Google Timezone API response: timeZoneName, timeZoneId, etc.

// Requires: Places.google.keys.server config
```

---

## 6. Distance & Geometry

```php
// Haversine distance between two points (returns meters)
$meters = Places::distance($lat1, $lon1, $lat2, $lon2);

// Human-readable distance label
$label = Places::distanceLabel(5000, 'km');     // "5 km"
$label = Places::distanceLabel(8047, 'miles');   // "5 miles"

// Heading in degrees from point 1 to point 2
$degrees = Places::heading($lat1, $lon1, $lat2, $lon2);

// Geohash encode/decode
$hash = Places_Geohash::encode(40.7128, -74.0060, 6);  // "dr5ru7"
// Length 6 ≈ ±610m precision

// Quantize coordinates to grid
list($latQ, $lonQ, $latGrid, $lonGrid) = Places::quantize($lat, $lon, $meters);
```

---

## 7. Geographic Reference Data

```php
// Look up a country
$country = new Places_Country();
$country->countryCode = 'US';
$country->retrieve();
// ->englishName, ->localName, ->emojiFlag, ->population, ->continent, ->currencyCode

// Look up a city by geonameId
$city = new Places_City();
$city->geonameId = 5128581;
$city->retrieve();
// ->englishName, ->localName, ->countryCode, ->latitude, ->longitude, ->geohash, ->timeZone

// Find nearest cities by geohash
$cities = Places_City::fetchByDistance($geohash, 10, array(
    'countryCode' => 'US'
));

// Look up postcode
$postcode = new Places_Postcode();
$postcode->countryCode = 'US';
$postcode->postcode = '10001';
$postcode->retrieve();
// ->latitude, ->longitude, ->geonameId, ->geohash

// Find nearby postcodes
$postcodes = Places_Postcode::nearby($latitude, $longitude, $meters, $limit);
// Returns array of Places_Postcode objects sorted by distance

// IP geolocation
$row = Places::lookupFromRequest(array(
    'join' => array('city', 'country', 'postcode'),
    'trustProxy' => false
));
// Returns Db_Row with geonameId, countryCode, latitude, longitude, postcode

// Direct IP lookup
$row = Places_Ipv4::lookup($ipv4String, $options);
$row = Places_Ipv6::lookup($ipv6String, $options);

// Region/district lookups
$region = new Places_Region();
$region->countryCode = 'US';
$region->regionCode = 'NY';
$region->retrieve();  // ->englishName = "New York"

$district = new Places_District();
$district->countryCode = 'US';
$district->regionCode = 'NY';
$district->districtCode = '061';
$district->retrieve();  // ->englishName = "New York County"
```

---

## 8. Interest-Based Nearby

```php
// Create/fetch category streams for a geographic interest
$streams = Places_Interest::streams(
    $publisherId,
    $latitude, $longitude,
    'Live Music',                    // interest title (normalized)
    array('experienceId' => 'main')
);
// Creates streams like: Places/interest/main/{geohash}/{meters}/live_music

// Query related content by interest + location + time
$relations = Places_Interest::related(
    $publisherId,
    'MyPlugin/events',
    'Live Music',
    'main',                          // experienceId
    array(
        'latitude' => $lat,
        'longitude' => $lon,
        'meters' => 50000
    )
);
```

---

## 9. Polylines & Routes

```php
// Decode a Google Directions route to polyline
$polyline = Places::polyline($googleRoute, array('platform' => 'google'));
// Returns array of ['x' => lat, 'y' => lng] points

// Find closest point on a polyline to a given point
$result = Places::closest(
    array('x' => $lat, 'y' => $lng),
    $polyline
);
// Returns: index, x, y, distance, fraction
```

---

## 10. Configuration Reference

```
Places.nearby.meters         — array of distance tiers [1000, 5000, ...]
Places.nearby.defaultMeters  — default tier (50000)
Places.nearby.units          — 'km' or 'miles'
Places.google.keys.server    — Google API key (server-side, REQUIRED)
Places.google.keys.web       — Google API key (client-side Maps JS)
Places.location.default.latitude/longitude — fallback when no user location
Places.location.ip.changed   — max IP-location updates (false=disable, true=unlimited, N=limit)
Places.location.ip.meters    — radius for IP-based location
Places.location.cache.duration — cache TTL for Google API responses (30 days default)
Places.geolocation.requireLogin — whether geolocation POST requires login
```

---

## 11. Common Mistakes

| Wrong | Right |
|-------|-------|
| Using arbitrary meters value with `forSubscribers` | Must be one of the values in `Places/nearby/meters` config |
| `Places_Nearby::subscribe(...)` without checking login | `subscribe`/`join` call `Users::loggedInUser(true)` — throws if not logged in |
| Trusting nearby results as exact matches | Filter with `Places::distance()` — grid overlap means some results are slightly out of range |
| Setting user location with `$stream->save()` | Use `Places_Location::changed()` — handles postcode lookup, geohash, join/leave, events |
| Hardcoding coordinates in nearby stream names | Use `Places_Nearby::streamName()` — handles geohash + meters encoding |
| Forgetting `Places.google.keys.server` config | Autocomplete and location lookup throw without it |
| Using `Places_Postcode::nearby()` for city lookup | Use `Places_City::fetchByDistance()` — postcodes are for zip/postal codes |
| `Places::quantize()` with raw $meters | Use `$meters * 2` for the grid (publishers use double-radius cells) |
| Querying `Places_Ipv4` with string IP | Columns are `INT UNSIGNED`; use `INET_ATON()` or the `lookup()` method |

---

## 12. Key Schema

### places_postcode
```sql
countryCode  varchar(2)    KEY
postcode     varchar(10)   KEY (countryCode, postcode)
geonameId    int           NULL
latitude     double        NULL
longitude    double        NULL
geohash      varchar(31)   KEY
```

### places_city
```sql
geonameId          int          PK AUTO_INCREMENT
countryCode        varchar(2)   KEY
normalizedName     varchar(180) KEY
englishName        varchar(180)
localName          varchar(180) KEY
regionGeonameId    int          NULL
districtGeonameId  int          NULL
latitude           double
longitude          double
geohash            varchar(31)  KEY
timeZone           varchar(40)  NULL
population         int          NULL
featureCode        varchar(10)  NULL
```

### places_country
```sql
countryCode    varchar(2)    PK
countryCode3   varchar(3)
geonameId      int           KEY
phoneCode      varchar(20)
normalizedName varchar(180)
englishName    varchar(180)
localName      varchar(180)
emojiFlag      varchar(8)
area           bigint        KEY
population     bigint        KEY
continent      varchar(2)    KEY
currencyCode   varchar(3)    KEY
currencyName   varchar(64)
```

### places_region
```sql
geonameId    int          PK
countryCode  varchar(2)
regionCode   varchar(20)
englishName  varchar(180)
localName    varchar(180) NULL
UNIQUE (countryCode, regionCode)
```

### places_location (geohash index for streams)
```sql
geohash      varchar(31)    KEY
publisherId  varbinary(31)
streamName   varbinary(255)
insertedTime timestamp
```

### places_ipv4
```sql
ipMin        int unsigned  PK
ipMax        int unsigned  PK
geonameId    int           KEY
countryCode  varchar(2)    KEY
postcode     varchar(20)   KEY
latitude     double        NULL
longitude    double        NULL
accuracy     int           NULL
```

### places_autocomplete (cache)
```sql
query      varchar(127)  PK
types      varchar(31)   PK
latitude   double        PK
longitude  double        PK
meters     double        PK
results    text
updatedTime timestamp    NULL
```