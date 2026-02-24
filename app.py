"""
NYC Subway Tracker - Backend API
Real-time subway arrival tracking using MTA GTFS feeds

Main endpoints:
- GET /api/stations - Returns list of all subway stations
- GET /api/arrivals?station_id=<id> - Returns real-time arrivals for a station
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from nyct_gtfs import NYCTFeed
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import json
import logging
import time
from threading import Lock
from datetime import datetime
import pytz
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static')
CORS(app)

# API key is optional - MTA no longer requires it, but library needs empty string
MTA_API_KEY = os.getenv('MTA_API_KEY', '')

EASTERN = pytz.timezone('America/New_York')

# MTA feed URLs for different subway lines
FEED_URLS = {
    '1,2,3,4,5,6,S': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
    'A,C,E,H,FS': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
    'N,Q,R,W': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
    'B,D,F,M': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
    'L': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l',
    'G': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g',
    'J,Z': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz',
    '7': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-7',
    'SIR': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si'
}

# Station lookup cached at startup — keyed by station id
STATIONS_BY_ID = {}

# Load stations at import time so both `python app.py` and gunicorn have data
def load_stations():
    global STATIONS_BY_ID
    try:
        with open('stations.json', 'r') as f:
            stations = json.load(f)
        STATIONS_BY_ID = {s['id']: s for s in stations}
        logger.info(f"Loaded {len(STATIONS_BY_ID)} stations from stations.json")
    except FileNotFoundError:
        logger.warning("stations.json not found — run generate_stations.py to create it")

load_stations()

# Feed-level TTL cache — keyed by feed URL, stores (NYCTFeed, fetched_at timestamp).
# Shared across requests so parallel threads/workers benefit from each other's fetches.
FEED_CACHE: dict = {}
FEED_CACHE_TTL = 30  # seconds — matches the frontend auto-refresh interval
FEED_CACHE_LOCK = Lock()


def fetch_feed(feed_url):
    """Return a cached NYCTFeed if fresh, otherwise fetch and cache a new one."""
    now = time.monotonic()

    with FEED_CACHE_LOCK:
        entry = FEED_CACHE.get(feed_url)
        if entry and (now - entry[1]) < FEED_CACHE_TTL:
            return entry[0]

    feed = NYCTFeed(feed_url, api_key=MTA_API_KEY)

    with FEED_CACHE_LOCK:
        FEED_CACHE[feed_url] = (feed, time.monotonic())

    return feed

def get_arrivals_from_feed(feed, station_ids):
    """Extract arrival info for the given station IDs from a single feed."""
    arrivals = []
    for query_station_id in station_ids:
        for suffix in ['N', 'S']:
            stop_id = f"{query_station_id}{suffix}"
            for trip in feed.trips:
                for stop_time_update in trip.stop_time_updates:
                    if stop_time_update.stop_id == stop_id:
                        arrival_time = stop_time_update.arrival
                        if arrival_time:
                            current_time = datetime.now(arrival_time.tzinfo)
                            minutes_until = int((arrival_time.timestamp() - current_time.timestamp()) / 60)

                            if minutes_until >= -1:
                                direction = trip.headsign_text if trip.headsign_text else (
                                    "Northbound" if suffix == 'N' else "Southbound"
                                )

                                route_id = trip.route_id
                                if route_id.endswith('X'):
                                    route_id = route_id[:-1]

                                arrival_time_et = arrival_time.astimezone(EASTERN)
                                arrivals.append({
                                    'route': route_id,
                                    'direction': direction,
                                    'arrival_time': arrival_time_et.strftime('%I:%M:%S %p'),
                                    'minutes_until_arrival': max(0, minutes_until)
                                })
    return arrivals


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/style.css')
def serve_css():
    return send_from_directory('static', 'style.css')

@app.route('/app.js')
def serve_js():
    return send_from_directory('static', 'app.js')

@app.route('/api/arrivals', methods=['GET'])
def get_arrivals():
    """
    Get real-time arrival data for a specific station.

    Query Parameters:
        station_id (str): The MTA station ID (e.g., '127' for Times Sq-42 St)

    Returns:
        JSON with arrivals (next per route/direction) and all_arrivals (all in next 30 mins)
    """
    station_id = request.args.get('station_id')

    if not station_id:
        return jsonify({'error': 'station_id parameter is required'}), 400

    station = STATIONS_BY_ID.get(station_id)
    station_ids_to_query = station.get('complex_ids', [station_id]) if station else [station_id]

    try:
        all_arrivals = []

        # Fetch all 9 feeds in parallel
        with ThreadPoolExecutor(max_workers=len(FEED_URLS)) as executor:
            futures = {
                executor.submit(fetch_feed, url): feed_name
                for feed_name, url in FEED_URLS.items()
            }
            for future in as_completed(futures):
                feed_name = futures[future]
                try:
                    feed = future.result()
                    all_arrivals.extend(get_arrivals_from_feed(feed, station_ids_to_query))
                except Exception as e:
                    logger.warning(f"Feed '{feed_name}' failed: {type(e).__name__}: {e}")

        # Filter to only arrivals in the next 30 minutes
        arrivals_30min = [a for a in all_arrivals if a['minutes_until_arrival'] <= 30]
        arrivals_30min.sort(key=lambda x: x['minutes_until_arrival'])

        if not arrivals_30min:
            return jsonify({
                'station_id': station_id,
                'arrivals': [],
                'all_arrivals': [],
                'message': 'No upcoming arrivals found. Please verify the station or try again later.'
            })

        # Keep only the next arrival for each (route, direction) pair for the summary view
        seen_pairs = set()
        unique_arrivals = []
        for arrival in arrivals_30min:
            pair = (arrival['route'], arrival['direction'])
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                unique_arrivals.append(arrival)

        ROUTE_ORDER = ['1', '2', '3', '4', '5', '6', '7',
                       'A', 'B', 'C', 'D', 'E', 'F', 'G',
                       'J', 'Z', 'L', 'M', 'N', 'Q', 'R', 'W',
                       'S', 'SIR', 'H', 'FS']

        def route_sort_key(arrival):
            route = arrival['route']
            route_index = ROUTE_ORDER.index(route) if route in ROUTE_ORDER else 999
            direction = arrival['direction'].lower()
            if any(word in direction for word in ['uptown', 'north', 'manhattan', 'inwood', 'harlem']):
                direction_index = 0
            elif any(word in direction for word in ['downtown', 'south', 'brooklyn', 'queens', 'coney']):
                direction_index = 1
            else:
                direction_index = 2
            return (route_index, direction_index, arrival['direction'])

        unique_arrivals.sort(key=route_sort_key)
        arrivals_30min.sort(key=route_sort_key)

        return jsonify({
            'station_id': station_id,
            'arrivals': unique_arrivals,
            'all_arrivals': arrivals_30min
        })

    except Exception as e:
        logger.error(f"Unexpected error fetching arrivals for station {station_id}: {e}")
        return jsonify({'error': f'Error fetching arrivals: {str(e)}'}), 500


@app.route('/api/stations', methods=['GET'])
def get_stations():
    """
    Return a comprehensive list of all NYC subway stations.

    Returns:
        JSON array of stations with id and name fields.
        Station complexes (like Times Sq) are pre-grouped in the data.
    """
    if not STATIONS_BY_ID:
        return jsonify({'error': 'Station data not found. Please run generate_stations.py first.'}), 500

    stations_simple = [{'id': s['id'], 'name': s['name']} for s in STATIONS_BY_ID.values()]
    return jsonify(stations_simple)


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(debug=True, port=port)
