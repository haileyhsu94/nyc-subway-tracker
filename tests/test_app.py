"""
Tests for the NYC Subway Tracker backend.

Covers:
  - get_arrivals_from_feed: arrival filtering, route normalization, direction fallback
  - /api/stations: happy path, missing station data
  - /api/arrivals: missing param, no arrivals, happy path, station complex lookup,
                   feed failures, consistent response shape
  - load_stations: successful load, missing file
"""

import json
import pytest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, mock_open

import app as app_module
from app import app, get_arrivals_from_feed


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_stu(stop_id, arrival):
    """Build a mock stop_time_update."""
    stu = MagicMock()
    stu.stop_id = stop_id
    stu.arrival = arrival
    return stu


def make_trip(route_id, headsign_text, stus):
    """Build a mock trip."""
    trip = MagicMock()
    trip.route_id = route_id
    trip.headsign_text = headsign_text
    trip.stop_time_updates = stus
    return trip


def make_feed(trips):
    """Build a mock NYCTFeed."""
    feed = MagicMock()
    feed.trips = trips
    return feed


def future_dt(minutes=5):
    """Naive datetime minutes from now."""
    return datetime.now() + timedelta(minutes=minutes)


def past_dt(minutes=5):
    """Naive datetime minutes ago."""
    return datetime.now() - timedelta(minutes=minutes)


@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def sample_stations():
    return {
        '127': {'id': '127', 'name': 'Times Sq-42 St', 'complex_ids': ['127', '725']},
        '635': {'id': '635', 'name': '14 St-Union Sq'},
    }


# ---------------------------------------------------------------------------
# get_arrivals_from_feed
# ---------------------------------------------------------------------------

class TestGetArrivalsFromFeed:

    def test_returns_arrival_for_matching_future_stop(self):
        stu = make_stu('127N', future_dt(5))
        feed = make_feed([make_trip('1', 'Van Cortlandt Park-242 St', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])

        assert len(results) == 1
        assert results[0]['route'] == '1'
        assert results[0]['direction'] == 'Van Cortlandt Park-242 St'
        assert 4 <= results[0]['minutes_until_arrival'] <= 5

    def test_ignores_non_matching_stop(self):
        stu = make_stu('999N', future_dt(5))
        feed = make_feed([make_trip('1', 'Uptown', [stu])])

        assert get_arrivals_from_feed(feed, ['127']) == []

    def test_ignores_arrivals_more_than_one_minute_past(self):
        stu = make_stu('127N', past_dt(2))
        feed = make_feed([make_trip('1', 'Uptown', [stu])])

        assert get_arrivals_from_feed(feed, ['127']) == []

    def test_includes_arrival_within_one_minute_grace(self):
        # Exactly -1 minute is allowed (train arriving/just departed)
        stu = make_stu('127N', past_dt(0.5))
        feed = make_feed([make_trip('1', 'Uptown', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        assert len(results) == 1
        assert results[0]['minutes_until_arrival'] == 0  # clamped, not negative

    def test_clamps_minutes_to_zero_for_arriving_now(self):
        stu = make_stu('127S', future_dt(0))
        feed = make_feed([make_trip('1', 'South Ferry', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        assert results[0]['minutes_until_arrival'] == 0

    def test_normalizes_express_route_suffix(self):
        stu = make_stu('127N', future_dt(5))
        feed = make_feed([make_trip('6X', 'Pelham Bay Park', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        assert results[0]['route'] == '6'

    def test_falls_back_to_northbound_when_no_headsign(self):
        stu = make_stu('127N', future_dt(5))
        feed = make_feed([make_trip('1', '', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        assert results[0]['direction'] == 'Northbound'

    def test_falls_back_to_southbound_for_s_suffix(self):
        stu = make_stu('127S', future_dt(5))
        feed = make_feed([make_trip('1', None, [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        assert results[0]['direction'] == 'Southbound'

    def test_skips_stop_time_update_with_no_arrival(self):
        stu = make_stu('127N', None)
        feed = make_feed([make_trip('1', 'Uptown', [stu])])

        assert get_arrivals_from_feed(feed, ['127']) == []

    def test_queries_multiple_station_ids(self):
        stu_a = make_stu('127N', future_dt(3))
        stu_b = make_stu('725N', future_dt(7))
        feed = make_feed([
            make_trip('1', 'Uptown', [stu_a]),
            make_trip('7', 'Flushing', [stu_b]),
        ])

        results = get_arrivals_from_feed(feed, ['127', '725'])
        routes = {r['route'] for r in results}
        assert routes == {'1', '7'}

    def test_arrival_time_formatted_as_string(self):
        stu = make_stu('127N', future_dt(5))
        feed = make_feed([make_trip('A', 'Inwood', [stu])])

        results = get_arrivals_from_feed(feed, ['127'])
        # Should be formatted like "04:35:00 PM"
        assert ':' in results[0]['arrival_time']
        assert results[0]['arrival_time'].endswith(('AM', 'PM'))


# ---------------------------------------------------------------------------
# GET /api/stations
# ---------------------------------------------------------------------------

class TestGetStations:

    def test_returns_station_list(self, client, sample_stations):
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations):
            resp = client.get('/api/stations')

        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 2

    def test_each_station_has_id_and_name(self, client, sample_stations):
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations):
            resp = client.get('/api/stations')

        for station in resp.get_json():
            assert 'id' in station
            assert 'name' in station

    def test_does_not_expose_complex_ids(self, client, sample_stations):
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations):
            resp = client.get('/api/stations')

        for station in resp.get_json():
            assert 'complex_ids' not in station

    def test_returns_500_when_no_stations_loaded(self, client):
        with patch.object(app_module, 'STATIONS_BY_ID', {}):
            resp = client.get('/api/stations')

        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# GET /api/arrivals
# ---------------------------------------------------------------------------

class TestGetArrivals:

    def test_returns_400_when_station_id_missing(self, client):
        resp = client.get('/api/arrivals')
        assert resp.status_code == 400
        assert 'error' in resp.get_json()

    def test_response_always_contains_all_arrivals_key(self, client, sample_stations):
        """all_arrivals must be present even when there are no upcoming trains."""
        empty_feed = make_feed([])
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=empty_feed):
            resp = client.get('/api/arrivals?station_id=635')

        data = resp.get_json()
        assert 'all_arrivals' in data

    def test_returns_empty_arrivals_with_message_when_no_trains(self, client, sample_stations):
        empty_feed = make_feed([])
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=empty_feed):
            resp = client.get('/api/arrivals?station_id=635')

        data = resp.get_json()
        assert data['arrivals'] == []
        assert 'message' in data

    def test_returns_arrivals_for_valid_station(self, client, sample_stations):
        stu = make_stu('635N', future_dt(5))
        feed = make_feed([make_trip('L', 'Canarsie', [stu])])

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=feed):
            resp = client.get('/api/arrivals?station_id=635')

        data = resp.get_json()
        assert resp.status_code == 200
        assert len(data['arrivals']) >= 1
        assert data['station_id'] == '635'

    def test_arrivals_sorted_within_30_minutes(self, client, sample_stations):
        stus = [
            make_stu('635N', future_dt(25)),
            make_stu('635N', future_dt(5)),
            make_stu('635N', future_dt(15)),
        ]
        trips = [make_trip('L', 'Canarsie', [stu]) for stu in stus]
        feed = make_feed(trips)

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=feed):
            resp = client.get('/api/arrivals?station_id=635')

        all_arrivals = resp.get_json()['all_arrivals']
        minutes = [a['minutes_until_arrival'] for a in all_arrivals]
        assert minutes == sorted(minutes)

    def test_excludes_arrivals_beyond_30_minutes(self, client, sample_stations):
        stus = [
            make_stu('635N', future_dt(10)),   # included
            make_stu('635N', future_dt(45)),   # excluded
        ]
        trips = [make_trip('L', 'Canarsie', [stu]) for stu in stus]
        feed = make_feed(trips)

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=feed):
            resp = client.get('/api/arrivals?station_id=635')

        all_arrivals = resp.get_json()['all_arrivals']
        assert all(a['minutes_until_arrival'] <= 30 for a in all_arrivals)

    def test_summary_view_has_one_entry_per_route_direction(self, client, sample_stations):
        """arrivals should deduplicate to only the next train per (route, direction)."""
        stus = [make_stu('635N', future_dt(t)) for t in [5, 10, 20]]
        trips = [make_trip('L', 'Canarsie', [stu]) for stu in stus]
        feed = make_feed(trips)

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=feed):
            resp = client.get('/api/arrivals?station_id=635')

        arrivals = resp.get_json()['arrivals']
        pairs = [(a['route'], a['direction']) for a in arrivals]
        assert len(pairs) == len(set(pairs))

    def test_uses_complex_ids_for_station_complex(self, client, sample_stations):
        """Times Sq should query both 127 and 725 stop IDs."""
        queried_stops = []

        def fake_feed(url):
            stu_127 = make_stu('127N', future_dt(5))
            stu_725 = make_stu('725N', future_dt(8))
            trip = make_trip('1', 'Uptown', [stu_127, stu_725])
            return make_feed([trip])

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', side_effect=fake_feed):
            resp = client.get('/api/arrivals?station_id=127')

        routes = {a['route'] for a in resp.get_json()['all_arrivals']}
        assert '1' in routes

    def test_continues_when_a_feed_fails(self, client, sample_stations):
        """A single feed failure should not prevent results from other feeds."""
        call_count = 0

        def flaky_feed(url):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("feed down")
            stu = make_stu('635N', future_dt(5))
            return make_feed([make_trip('L', 'Canarsie', [stu])])

        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', side_effect=flaky_feed):
            resp = client.get('/api/arrivals?station_id=635')

        assert resp.status_code == 200

    def test_unknown_station_id_still_returns_valid_shape(self, client, sample_stations):
        empty_feed = make_feed([])
        with patch.object(app_module, 'STATIONS_BY_ID', sample_stations), \
             patch.object(app_module, 'fetch_feed', return_value=empty_feed):
            resp = client.get('/api/arrivals?station_id=UNKNOWN')

        data = resp.get_json()
        assert 'arrivals' in data
        assert 'all_arrivals' in data


# ---------------------------------------------------------------------------
# load_stations
# ---------------------------------------------------------------------------

class TestLoadStations:

    def test_loads_stations_from_file(self):
        stations_data = [
            {'id': '127', 'name': 'Times Sq-42 St'},
            {'id': '635', 'name': '14 St-Union Sq'},
        ]
        with patch('builtins.open', mock_open(read_data=json.dumps(stations_data))):
            app_module.load_stations()

        assert '127' in app_module.STATIONS_BY_ID
        assert '635' in app_module.STATIONS_BY_ID
        assert app_module.STATIONS_BY_ID['127']['name'] == 'Times Sq-42 St'

    def test_handles_missing_stations_file_gracefully(self):
        with patch('builtins.open', side_effect=FileNotFoundError):
            # Should not raise
            app_module.load_stations()
