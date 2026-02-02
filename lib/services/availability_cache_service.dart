import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

class AvailabilityCacheEntry {
  AvailabilityCacheEntry({
    required this.fetchedAt,
    required this.days,
  });

  final DateTime fetchedAt;
  final List<Map<String, dynamic>> days;
}

class AvailabilityCacheService {
  AvailabilityCacheService._();

  static final AvailabilityCacheService _instance =
      AvailabilityCacheService._();

  factory AvailabilityCacheService() => _instance;

  static const Duration defaultMaxAge = Duration(minutes: 3);
  static const Duration defaultRevalidateWindow = Duration(seconds: 45);

  final Map<String, AvailabilityCacheEntry> _cache = {};
  final Map<String, Future<AvailabilityCacheEntry?>> _inFlight = {};

  String buildKey({
    required String baseUrl,
    required String username,
    required int days,
    DateTime? startDate,
    String? club,
  }) {
    final startKey = startDate == null
        ? ''
        : '${startDate.year.toString().padLeft(4, '0')}-${startDate.month.toString().padLeft(2, '0')}-${startDate.day.toString().padLeft(2, '0')}';
    return '${baseUrl.toLowerCase()}|${username.toLowerCase()}|$days|${club ?? ''}|$startKey';
  }

  AvailabilityCacheEntry? getFresh(
    String key, {
    Duration maxAge = defaultMaxAge,
  }) {
    final entry = _cache[key];
    if (entry == null) return null;
    if (DateTime.now().difference(entry.fetchedAt) > maxAge) return null;
    return entry;
  }

  bool _needsRevalidate(AvailabilityCacheEntry entry, Duration maxAge,
      Duration revalidateWindow) {
    final age = DateTime.now().difference(entry.fetchedAt);
    if (age >= maxAge) return true;
    return (maxAge - age) <= revalidateWindow;
  }

  Future<AvailabilityCacheEntry?> fetchAndCache({
    required String baseUrl,
    required String username,
    required String password,
    required int days,
    DateTime? startDate,
    String? club,
    bool reuseBrowser = true,
    Duration timeout = const Duration(seconds: 90),
  }) async {
    final key =
        buildKey(baseUrl: baseUrl, username: username, days: days, startDate: startDate, club: club);
    final inFlight = _inFlight[key];
    if (inFlight != null) return inFlight;

    final future = _fetchAndCacheInternal(
      baseUrl: baseUrl,
      username: username,
      password: password,
      days: days,
      startDate: startDate,
      club: club,
      reuseBrowser: reuseBrowser,
      timeout: timeout,
    );
    _inFlight[key] = future;
    final result = await future;
    _inFlight.remove(key);
    return result;
  }

  Future<AvailabilityCacheEntry?> getOrFetch({
    required String baseUrl,
    required String username,
    required String password,
    required int days,
    DateTime? startDate,
    String? club,
    bool reuseBrowser = true,
    Duration maxAge = defaultMaxAge,
    Duration revalidateWindow = defaultRevalidateWindow,
  }) async {
    final key =
        buildKey(baseUrl: baseUrl, username: username, days: days, startDate: startDate, club: club);
    final cached = getFresh(key, maxAge: maxAge);
    if (cached != null) {
      if (_needsRevalidate(cached, maxAge, revalidateWindow)) {
        // Stale-while-revalidate: refresh in background.
        unawaited(fetchAndCache(
          baseUrl: baseUrl,
          username: username,
          password: password,
          days: days,
          startDate: startDate,
          club: club,
          reuseBrowser: reuseBrowser,
        ));
      }
      return cached;
    }
    return fetchAndCache(
      baseUrl: baseUrl,
      username: username,
      password: password,
      days: days,
      startDate: startDate,
      club: club,
      reuseBrowser: reuseBrowser,
    );
  }

  Future<AvailabilityCacheEntry?> _fetchAndCacheInternal({
    required String baseUrl,
    required String username,
    required String password,
    required int days,
    DateTime? startDate,
    String? club,
    bool reuseBrowser = true,
    Duration timeout = const Duration(seconds: 90),
  }) async {
    final uri = Uri.parse('$baseUrl/api/fetch-tee-times-range');
    final start = startDate ?? DateTime.now();
    final startKey =
        '${start.year.toString().padLeft(4, '0')}-${start.month.toString().padLeft(2, '0')}-${start.day.toString().padLeft(2, '0')}';
    final payload = {
      'startDate': startKey,
      'days': days,
      'username': username,
      'password': password,
      if (club != null) 'club': club,
      'reuseBrowser': reuseBrowser,
    };

    final response = await http
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode(payload),
        )
        .timeout(timeout);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return null;
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return null;
    if (decoded['success'] != true) return null;
    if (decoded['days'] is! List) return null;

    final rawDays = (decoded['days'] as List)
        .whereType<Map>()
        .map((m) => m.cast<String, dynamic>())
        .toList();

    final entry =
        AvailabilityCacheEntry(fetchedAt: DateTime.now(), days: rawDays);
    _cache[
        buildKey(
          baseUrl: baseUrl,
          username: username,
          days: days,
          startDate: startDate,
          club: club)] =
      entry;
    return entry;
  }
}
