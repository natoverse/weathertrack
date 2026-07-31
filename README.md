# weathertrack

WeatherTrack is a web-based mapping app for planning multi-day trips and
understanding the weather you can expect along the way. It's built primarily
with hiking and mountaineering in mind, so you can anticipate conditions for
every day of a trip before you head out.

## What it does

- **Draw multi-day tracks on a map.** Plot the route for a trip and break it
  into daily segments, each with a planned stop point.
- **Import and export GPX tracks.** Bring an existing GPX track into the trip
  planner or download the current trip track as a GPX file.
- **Per-day weather forecasts.** For each day, WeatherTrack retrieves forecasts
  at the planned stop and halfway along the track between stops. It also shows
  the weather for the day after the final stop.
- **Trip-wide weather overview.** See the forecast across the full duration of
  the trip so you can understand weather expectations from start to finish.

## Weather data sources

- **[NWS (National Weather Service)](https://www.weather.gov/documentation/services-web-api)**
  is the initial forecast provider.
- Additional sources may be integrated over time to expand coverage and
  redundancy.

## Trip storage setup

Shared trips are stored as JSON in
[Firebase Realtime Database](https://firebase.google.com/docs/database). To
configure storage:

1. Create a Firebase project and a Realtime Database.
2. Publish `database.rules.json` as the database's rules.
3. Set `WEATHERTRACK_DATABASE_URL` in `firebase-config.js` to the database URL
   shown in the Firebase console, such as
   `https://PROJECT_ID-default-rtdb.firebaseio.com`.

The database URL is public configuration, not a credential. The included rules
allow anyone to list, load, create, and delete trips; editing an existing trip
is denied. No Firebase user authentication is required.

## Status

WeatherTrack is in early development. Features and documentation will evolve as
the project grows.
