import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:fairway_sniper/services/firebase_service.dart';
import 'package:fairway_sniper/services/agent_base_url.dart';
import 'package:fairway_sniper/services/player_directory_service.dart';
import 'package:fairway_sniper/services/availability_cache_service.dart';

enum PrefetchStep {
  idle,
  checkingAgent,
  fetchingPlayers,
  fetchingAvailability,
  ready,
  failed,
}

class BookingPrefetchState {
  BookingPrefetchState({
    required this.step,
    required this.progress,
    required this.statusText,
    this.error,
    this.updatedAt,
  });

  final PrefetchStep step;
  final double progress;
  final String statusText;
  final String? error;
  final DateTime? updatedAt;

  bool get isReady => step == PrefetchStep.ready;
  bool get hasError => step == PrefetchStep.failed;
}

class BookingPrefetchService extends ChangeNotifier {
  BookingPrefetchService({
    FirebaseService? firebaseService,
    PlayerDirectoryService? playerDirectoryService,
    AvailabilityCacheService? availabilityCacheService,
  })  : _firebaseService = firebaseService ?? FirebaseService(),
        _playerDirectoryService = playerDirectoryService ??
            PlayerDirectoryService(firebaseService: firebaseService ?? FirebaseService()),
        _availabilityCacheService =
            availabilityCacheService ?? AvailabilityCacheService();

  final FirebaseService _firebaseService;
  final PlayerDirectoryService _playerDirectoryService;
  final AvailabilityCacheService _availabilityCacheService;

  bool _running = false;
  BookingPrefetchState _state = BookingPrefetchState(
    step: PrefetchStep.idle,
    progress: 0,
    statusText: 'Idle',
  );

  BookingPrefetchState get state => _state;
  bool get isRunning => _running;

  void _setState(BookingPrefetchState next) {
    _state = next;
    notifyListeners();
  }

  Future<void> run({bool forceRefresh = false}) async {
    if (_running) return;
    _running = true;
    _setState(BookingPrefetchState(
      step: PrefetchStep.checkingAgent,
      progress: 0.05,
      statusText: 'Checking agent…',
    ));

    try {
      final userId = _firebaseService.currentUserId;
      if (userId == null) {
        _setState(BookingPrefetchState(
          step: PrefetchStep.failed,
          progress: 0,
          statusText: 'Sign in to prepare booking data',
          error: 'No user',
        ));
        return;
      }

      final creds = await _firebaseService.loadBRSCredentials(userId);
      if (creds == null) {
        _setState(BookingPrefetchState(
          step: PrefetchStep.failed,
          progress: 0,
          statusText: 'No BRS credentials saved',
          error: 'Missing credentials',
        ));
        return;
      }

      final username = (creds['username'] ?? '').toString().trim();
      final password = (creds['password'] ?? '').toString();
      final club = creds['club']?.toString();
      if (username.isEmpty || password.isEmpty) {
        _setState(BookingPrefetchState(
          step: PrefetchStep.failed,
          progress: 0,
          statusText: 'BRS credentials incomplete',
          error: 'Invalid credentials',
        ));
        return;
      }

      final baseUrl = await getAgentBaseUrl();
      final healthResp = await http
          .get(Uri.parse('$baseUrl/api/health'))
          .timeout(const Duration(seconds: 8));
      if (healthResp.statusCode != 200) {
        _setState(BookingPrefetchState(
          step: PrefetchStep.failed,
          progress: 0.05,
          statusText: 'Agent not reachable',
          error: 'Health check failed',
        ));
        return;
      }

      _setState(BookingPrefetchState(
        step: PrefetchStep.fetchingPlayers,
        progress: 0.33,
        statusText: 'Fetching players…',
      ));

      await _playerDirectoryService.getDirectory(
        forceRefresh: forceRefresh,
        username: username,
        password: password,
      );

      _setState(BookingPrefetchState(
        step: PrefetchStep.fetchingAvailability,
        progress: 0.66,
        statusText: 'Fetching availability…',
      ));

      if (forceRefresh) {
        await _availabilityCacheService.fetchAndCache(
          baseUrl: baseUrl,
          username: username,
          password: password,
          days: 5,
          startDate: DateTime.now(),
          club: club,
          reuseBrowser: false,
        );
      } else {
        await _availabilityCacheService.getOrFetch(
          baseUrl: baseUrl,
          username: username,
          password: password,
          days: 5,
          startDate: DateTime.now(),
          club: club,
          reuseBrowser: false,
        );
      }

      _setState(BookingPrefetchState(
        step: PrefetchStep.ready,
        progress: 1,
        statusText: 'Ready to book',
        updatedAt: DateTime.now(),
      ));
    } catch (e) {
      _setState(BookingPrefetchState(
        step: PrefetchStep.failed,
        progress: 0.1,
        statusText: 'Prefetch failed',
        error: e.toString(),
      ));
    } finally {
      _running = false;
    }
  }
}

